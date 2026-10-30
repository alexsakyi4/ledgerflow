import { BankAccountType, BankTransactionStatus, DocumentStatus, DocumentType, Prisma } from "@prisma/client";
import { parse as parseCsv } from "csv-parse/sync";
import { db } from "../config/db";
import { AppError } from "../middleware/error";
import { createPostedJournal } from "./journal.service";
import { settlementFx } from "../utils/foreignExchange";

type Tx = Prisma.TransactionClient;
async function exchangeRate(client: any, companyId: string, currency: string, homeCurrency: string, date: Date) {
  if (currency === homeCurrency) return new Prisma.Decimal(1);
  const direct = await client.currencyRate.findFirst({ where: { companyId, baseCurrency: currency, quoteCurrency: homeCurrency, rateDate: { lte: date } }, orderBy: { rateDate: "desc" } });
  if (direct) return new Prisma.Decimal(direct.rate);
  const inverse = await client.currencyRate.findFirst({ where: { companyId, baseCurrency: homeCurrency, quoteCurrency: currency, rateDate: { lte: date } }, orderBy: { rateDate: "desc" } });
  if (inverse && !new Prisma.Decimal(inverse.rate).isZero()) return new Prisma.Decimal(1).div(inverse.rate);
  throw new AppError(`No exchange rate is configured for ${currency}/${homeCurrency} on or before ${date.toISOString().slice(0,10)}`, 400);
}
export class BankingService {
  static async listAccounts(companyId: string) { return db.bankAccount.findMany({ where: { companyId }, include: { account: { select: { code: true, name: true, type: true, currency: true } } }, orderBy: { name: "asc" } }); }
  static async createAccount(companyId: string, input: { name: string; accountId: string; type: BankAccountType; institution?: string | null; accountMask?: string | null; openingBalance?: string | number }) {
    const account = await db.account.findFirst({ where: { id: input.accountId, companyId, isActive: true } });
    if (!account || !["ASSET", "LIABILITY"].includes(account.type)) throw new AppError("Select an active bank or liability account from this company", 400);
    return db.bankAccount.create({ data: { companyId, name: input.name.trim(), accountId: input.accountId, type: input.type, institution: input.institution || null, accountMask: input.accountMask || null, openingBalance: new Prisma.Decimal(input.openingBalance ?? 0) }, include: { account: true } });
  }
  static async importStatement(companyId: string, userId: string, bankAccountId: string, fileName: string, content: string, format: "CSV" | "OFX") {
    const bank = await db.bankAccount.findFirst({ where: { id: bankAccountId, companyId, isActive: true } }); if (!bank) throw new AppError("Bank account not found", 404);
    const parsed = format === "CSV" ? parseBankCsv(content) : parseOfx(content);
    if (!parsed.length) throw new AppError("Statement contains no transactions", 400);
    let importedRows=0; const errors:Array<{row:number;message:string}>=[];
    for(let i=0;i<parsed.length;i++){
      const row=parsed[i];
      try {
        if(!row.date || Number.isNaN(new Date(row.date).getTime()))throw new Error("Valid date is required");
        if(!row.description)throw new Error("Description is required");
        const amount=new Prisma.Decimal(row.amount).toDecimalPlaces(4,Prisma.Decimal.ROUND_HALF_UP);if(amount.isZero())throw new Error("Transaction amount cannot be zero");
        const transactionDate=new Date(row.date);
        if(!row.externalId){
          const dayStart=new Date(Date.UTC(transactionDate.getUTCFullYear(),transactionDate.getUTCMonth(),transactionDate.getUTCDate()));
          const dayEnd=new Date(dayStart.getTime()+86400000-1);
          const duplicate=await db.bankTransaction.findFirst({where:{companyId,bankAccountId,externalId:null,transactionDate:{gte:dayStart,lte:dayEnd},amount,description:row.description.slice(0,500),reference:row.reference||null}});
          if(duplicate){errors.push({row:i+2,message:"Duplicate transaction skipped"});continue;}
        }
        await db.bankTransaction.create({data:{companyId,bankAccountId,transactionDate,description:row.description.slice(0,500),reference:row.reference||null,externalId:row.externalId||null,amount}});
        importedRows++;
      } catch(error:any){if(error.code==="P2002"){errors.push({row:i+2,message:"Duplicate transaction skipped"});}else errors.push({row:i+2,message:error.message});}
    }
    const batch=await db.importBatch.create({data:{companyId,userId,entity:"TRANSACTIONS",fileName,totalRows:parsed.length,importedRows,rejectedRows:parsed.length-importedRows,errors:errors as unknown as Prisma.InputJsonValue}});
    return {batchId:batch.id,totalRows:parsed.length,importedRows,rejectedRows:parsed.length-importedRows,errors};
  }
  static async feed(companyId:string,bankAccountId:string,status?:BankTransactionStatus){return db.bankTransaction.findMany({where:{companyId,bankAccountId,...(status?{status}:{})},include:{matchedDocument:{select:{id:true,number:true,type:true,status:true,total:true}}},orderBy:[{transactionDate:"desc"},{createdAt:"desc"}],take:1000});}
  static async suggestions(companyId: string, transactionId: string) {
    const transaction = await db.bankTransaction.findFirst({ where: { id: transactionId, companyId } });
    if (!transaction) throw new AppError("Bank transaction not found", 404);
    const company = await db.company.findUniqueOrThrow({ where: { id: companyId }, select: { currency: true } });
    const incoming = transaction.amount.gt(0);
    const types = incoming ? [DocumentType.INVOICE] : [DocumentType.BILL, DocumentType.EXPENSE];
    const openDocs = await db.businessDocument.findMany({
      where: { companyId, type: { in: types }, status: incoming ? { in: [DocumentStatus.SENT, DocumentStatus.PARTIALLY_PAID, DocumentStatus.OVERDUE] } : { in: [DocumentStatus.APPROVED, DocumentStatus.PARTIALLY_PAID, DocumentStatus.OVERDUE, DocumentStatus.PAID] }, issueDate: { lte: new Date(transaction.transactionDate.getTime() + 45 * 86400000) } },
      include: { contact: { select: { id: true, displayName: true } } }, take: 200,
    });
    const amount = transaction.amount.abs();
    const candidates = [] as Array<any>;
    for (const doc of openDocs) {
      try {
        let expectedHome: Prisma.Decimal;
        let remainingNative = new Prisma.Decimal(doc.total).minus(doc.amountPaid);
        if (doc.type === DocumentType.EXPENSE) {
          expectedHome = doc.homeCurrencyTotal.isZero() ? new Prisma.Decimal(doc.total).mul(doc.exchangeRate) : new Prisma.Decimal(doc.homeCurrencyTotal);
          remainingNative = new Prisma.Decimal(0);
        } else {
          const rate = await exchangeRate(db, companyId, doc.currency, company.currency, transaction.transactionDate);
          expectedHome = remainingNative.mul(rate);
        }
        const variance = expectedHome.minus(amount).abs();
        const score = variance.lte(new Prisma.Decimal("0.01")) ? 100 : Math.max(0, 100 - Math.round(variance.div(amount.isZero() ? 1 : amount).mul(100).toNumber()));
        if (score >= 50) candidates.push({ ...doc, outstanding: remainingNative.toString(), expectedHome: expectedHome.toFixed(2), score });
      } catch { /* No dated rate: do not suggest an unsafe FX match. */ }
    }
    return candidates.sort((a, b) => b.score - a.score);
  }

  static async match(companyId: string, userId: string, transactionId: string, documentId: string) {
    return db.$transaction(async (tx) => {
      const txRow = await tx.bankTransaction.findFirst({ where: { id: transactionId, companyId }, include: { bankAccount: { include: { account: true } } } });
      if (!txRow) throw new AppError("Bank transaction not found", 404);
      if (txRow.status !== BankTransactionStatus.UNMATCHED) throw new AppError("Only unmatched transactions can be matched", 409);
      if (txRow.amount.isZero()) throw new AppError("A zero-value bank transaction cannot be matched", 400);
      const doc = await tx.businessDocument.findFirst({ where: { id: documentId, companyId } });
      if (!doc) throw new AppError("Transaction to match was not found", 404);
      const incoming = txRow.amount.gt(0);
      const eligible: DocumentStatus[] = incoming
        ? [DocumentStatus.SENT, DocumentStatus.PARTIALLY_PAID, DocumentStatus.OVERDUE]
        : [DocumentStatus.APPROVED, DocumentStatus.PARTIALLY_PAID, DocumentStatus.OVERDUE, DocumentStatus.PAID];
      if (incoming && doc.type !== DocumentType.INVOICE) throw new AppError("Incoming bank transactions can be matched to invoices", 400);
      if (!incoming && !([DocumentType.BILL, DocumentType.EXPENSE] as DocumentType[]).includes(doc.type)) throw new AppError("Outgoing bank transactions can be matched to bills or expenses", 400);
      if (!eligible.includes(doc.status)) throw new AppError("This business transaction is not open for matching", 409);

      if (doc.type === DocumentType.EXPENSE) {
        const linked = doc.journalEntryId ? await tx.journalLine.findFirst({ where: { entryId: doc.journalEntryId, accountId: txRow.bankAccount.accountId } }) : null;
        if (!linked) throw new AppError("Expense was not recorded against this bank account; use split/categorize instead", 400);
        const expectedHome = doc.homeCurrencyTotal.isZero() ? new Prisma.Decimal(doc.total).mul(doc.exchangeRate) : new Prisma.Decimal(doc.homeCurrencyTotal);
        if (expectedHome.minus(txRow.amount.abs()).abs().gt("0.01")) throw new AppError("Bank amount does not match the recorded expense; use split/categorize instead", 409);
      } else {
        const company = await tx.company.findUniqueOrThrow({ where: { id: companyId }, select: { currency: true } });
        const rate = await exchangeRate(tx, companyId, doc.currency, company.currency, txRow.transactionDate);
        const nativeOutstanding = new Prisma.Decimal(doc.total).minus(doc.amountPaid);
        const nativePaid = txRow.amount.abs().div(rate).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
        if (!nativeOutstanding.gt(0) || !nativePaid.gt(0) || nativePaid.gt(nativeOutstanding)) throw new AppError("Bank amount exceeds the outstanding transaction balance", 409);
        const carryingRate = doc.exchangeRate.isZero() ? new Prisma.Decimal(1) : new Prisma.Decimal(doc.exchangeRate);
        const carryingHome = nativePaid.mul(carryingRate).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
        const cashHome = txRow.amount.abs().toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
        const control = await tx.account.findFirst({ where: { companyId, code: incoming ? "1100" : "2000", isActive: true } });
        if (!control) throw new AppError("Required control account is missing", 400);
        const lines: Array<{ accountId: string; description?: string; debit: string | number; credit: string | number }> = incoming
          ? [{ accountId: txRow.bankAccount.accountId, description: txRow.bankAccount.name, debit: cashHome.toFixed(4), credit: 0 }, { accountId: control.id, description: "Accounts Receivable settlement", debit: 0, credit: carryingHome.toFixed(4) }]
          : [{ accountId: control.id, description: "Accounts Payable settlement", debit: carryingHome.toFixed(4), credit: 0 }, { accountId: txRow.bankAccount.accountId, description: txRow.bankAccount.name, debit: 0, credit: cashHome.toFixed(4) }];
        const fx = settlementFx(cashHome, carryingHome, incoming ? "RECEIVABLE" : "PAYABLE");
        if (fx.gain.gt(0)) {
          const gain = await tx.account.findFirst({ where: { companyId, code: "4300", isActive: true } });
          if (!gain) throw new AppError("Realized FX gain account is missing", 400);
          lines.push({ accountId: gain.id, description: "Realized foreign exchange gain", debit: 0, credit: fx.gain.toFixed(4) });
        }
        if (fx.loss.gt(0)) {
          const loss = await tx.account.findFirst({ where: { companyId, code: "6800", isActive: true } });
          if (!loss) throw new AppError("Realized FX loss account is missing", 400);
          lines.push({ accountId: loss.id, description: "Realized foreign exchange loss", debit: fx.loss.toFixed(4), credit: 0 });
        }
        await createPostedJournal(tx, companyId, userId, { date: txRow.transactionDate, reference: txRow.reference || txRow.externalId, memo: `Bank match ${txRow.description}`, sourceType: "BANK_MATCH", sourceId: txRow.id, lines });
        const paid = new Prisma.Decimal(doc.amountPaid).plus(nativePaid);
        await tx.businessDocument.update({ where: { id: doc.id }, data: { amountPaid: paid, status: paid.gte(doc.total) ? DocumentStatus.PAID : DocumentStatus.PARTIALLY_PAID } });
      }
      return tx.bankTransaction.update({ where: { id: transactionId }, data: { status: BankTransactionStatus.MATCHED, matchedDocumentId: doc.id } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
  static async reject(companyId:string,transactionId:string){const row=await db.bankTransaction.findFirst({where:{id:transactionId,companyId,status:BankTransactionStatus.UNMATCHED}});if(!row)throw new AppError("Unmatched bank transaction not found",404);return db.bankTransaction.update({where:{id:row.id},data:{status:BankTransactionStatus.EXCLUDED}});}
  static async split(companyId:string,userId:string,transactionId:string,allocations:Array<{accountId:string;amount:string|number;description?:string}>){return db.$transaction(async(tx)=>{const row=await tx.bankTransaction.findFirst({where:{id:transactionId,companyId,status:BankTransactionStatus.UNMATCHED},include:{bankAccount:{include:{account:true}}}});if(!row)throw new AppError("Unmatched bank transaction not found",404);const sum=allocations.reduce((v,a)=>v.plus(a.amount),new Prisma.Decimal(0));if(!sum.equals(row.amount.abs()))throw new AppError("Split allocations must equal the bank transaction amount",400);const accountIds=[...new Set(allocations.map(a=>a.accountId))];const accounts=await tx.account.findMany({where:{id:{in:accountIds},companyId,isActive:true}});if(accounts.length!==accountIds.length)throw new AppError("Every split account must belong to this company",400);const lines=allocations.map(a=>({accountId:a.accountId,description:a.description||"Bank split",debit:row.amount.isNegative()?a.amount:0,credit:row.amount.gt(0)?a.amount:0}));lines.push(row.amount.gt(0)?{accountId:row.bankAccount.accountId,description:row.description,debit:0,credit:row.amount.abs().toString()}:{accountId:row.bankAccount.accountId,description:row.description,debit:row.amount.abs().toString(),credit:0});await createPostedJournal(tx,companyId,userId,{date:row.transactionDate,reference:row.reference,memo:`Bank transaction ${row.description}`,sourceType:"BANK_SPLIT",sourceId:row.id,lines});return tx.bankTransaction.update({where:{id:row.id},data:{status:BankTransactionStatus.MATCHED}});},{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});}
  static async transfer(companyId:string,userId:string,input:{fromBankAccountId:string;toBankAccountId:string;amount:string|number;date:Date;memo?:string}){if(input.fromBankAccountId===input.toBankAccountId)throw new AppError("Choose two different accounts",400);const amount=new Prisma.Decimal(input.amount);if(!amount.gt(0))throw new AppError("Transfer amount must be positive",400);return db.$transaction(async(tx)=>{const [from,to]=await Promise.all([tx.bankAccount.findFirst({where:{id:input.fromBankAccountId,companyId,isActive:true}}),tx.bankAccount.findFirst({where:{id:input.toBankAccountId,companyId,isActive:true}})]);if(!from||!to)throw new AppError("Both bank accounts must belong to this company",404);return createPostedJournal(tx,companyId,userId,{date:input.date,reference:`XFER-${Date.now()}`,memo:input.memo||"Account transfer",sourceType:"TRANSFER",sourceId:`${from.id}-${to.id}-${Date.now()}`,lines:[{accountId:to.accountId,debit:amount.toString(),credit:0},{accountId:from.accountId,debit:0,credit:amount.toString()}]});},{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});}
  static async startReconciliation(companyId: string, bankAccountId: string, input: { statementEndDate: Date; statementEndBalance: string | number; transactionIds: string[] }) {
    const statementEndDate = new Date(input.statementEndDate);
    if (Number.isNaN(statementEndDate.getTime())) throw new AppError("Statement end date is invalid", 400);
    if (statementEndDate.getUTCHours() === 0 && statementEndDate.getUTCMinutes() === 0 && statementEndDate.getUTCSeconds() === 0) statementEndDate.setUTCHours(23, 59, 59, 999);

    return db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${bankAccountId}))`;
      const bank = await tx.bankAccount.findFirst({ where: { id: bankAccountId, companyId, isActive: true } });
      if (!bank) throw new AppError("Bank account not found", 404);
      const inProgress = await tx.bankReconciliation.findFirst({ where: { companyId, bankAccountId, status: "IN_PROGRESS" } });
      if (inProgress) throw new AppError("Complete or cancel the in-progress reconciliation before starting another", 409);
      const previous = await tx.bankReconciliation.findFirst({ where: { companyId, bankAccountId, status: "COMPLETED" }, orderBy: { statementEndDate: "desc" } });
      if (previous && statementEndDate <= previous.statementEndDate) throw new AppError("Statement end date must be after the previous completed reconciliation", 409);
      const beginningBalance = previous ? new Prisma.Decimal(previous.statementEndBalance) : new Prisma.Decimal(bank.openingBalance);
      const txns = await tx.bankTransaction.findMany({ where: { companyId, bankAccountId, transactionDate: { lte: statementEndDate, ...(previous ? { gt: previous.statementEndDate } : {}) }, status: { not: BankTransactionStatus.EXCLUDED }, ...(input.transactionIds.length ? { id: { in: input.transactionIds } } : {}) } });
      const reconciliation = await tx.bankReconciliation.create({ data: { companyId, bankAccountId, statementEndDate, statementEndBalance: new Prisma.Decimal(input.statementEndBalance), beginningBalance } });
      if (txns.length) await tx.bankReconciliationItem.createMany({ data: txns.map((item) => ({ reconciliationId: reconciliation.id, bankTransactionId: item.id, cleared: item.status === BankTransactionStatus.RECONCILED })) });
      return tx.bankReconciliation.findUniqueOrThrow({ where: { id: reconciliation.id }, include: { items: { include: { bankTransaction: true } } } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
  static async updateReconciliationCleared(companyId: string, id: string, transactionIds: string[]) {
    return db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
      const rec = await tx.bankReconciliation.findFirst({ where: { id, companyId }, include: { items: { select: { bankTransactionId: true } } } });
      if (!rec) throw new AppError("Reconciliation not found", 404);
      if (rec.status !== "IN_PROGRESS") throw new AppError("This reconciliation is not in progress", 409);
      const allowed = new Set(rec.items.map((item) => item.bankTransactionId));
      if (transactionIds.some((transactionId) => !allowed.has(transactionId))) throw new AppError("Cleared items must belong to this reconciliation", 400);
      await tx.bankReconciliationItem.updateMany({ where: { reconciliationId: id }, data: { cleared: false } });
      if (transactionIds.length) await tx.bankReconciliationItem.updateMany({ where: { reconciliationId: id, bankTransactionId: { in: transactionIds } }, data: { cleared: true } });
      return tx.bankReconciliation.findUnique({ where: { id }, include: { items: { include: { bankTransaction: true } } } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
  static async cancelReconciliation(companyId:string,userId:string,id:string){return db.$transaction(async(tx)=>{await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;const rec=await tx.bankReconciliation.findFirst({where:{id,companyId}});if(!rec)throw new AppError("Reconciliation not found",404);if(rec.status!=="IN_PROGRESS")throw new AppError("Only an in-progress reconciliation can be cancelled",409);await tx.auditLog.create({data:{companyId,userId,action:"DELETE",entity:"BankReconciliation",entityId:id,oldValues:{statementEndDate:rec.statementEndDate.toISOString(),statementEndBalance:rec.statementEndBalance.toString()}}});await tx.bankReconciliation.delete({where:{id}});return{cancelled:true};});}
  static async completeReconciliation(companyId:string,id:string){return db.$transaction(async(tx)=>{
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
    const rec=await tx.bankReconciliation.findFirst({where:{id,companyId},include:{bankAccount:true,items:{include:{bankTransaction:true}}}});
    if(!rec)throw new AppError("Reconciliation not found",404);
    if(rec.status!=="IN_PROGRESS")throw new AppError("This reconciliation is not in progress",409);
    const cleared=rec.items.filter(item=>item.cleared);
    if(cleared.some(item=>item.bankTransaction.status===BankTransactionStatus.EXCLUDED))throw new AppError("An excluded transaction is still marked cleared; remove it from the reconciliation first",409);
    const balance=cleared.reduce((sum,item)=>sum.plus(item.bankTransaction.amount),new Prisma.Decimal(rec.beginningBalance));
    if(!balance.equals(rec.statementEndBalance))throw new AppError(`Reconciliation is out of balance by ${new Prisma.Decimal(rec.statementEndBalance).minus(balance).toFixed(2)}`,409);
    await tx.bankTransaction.updateMany({where:{id:{in:cleared.map(item=>item.bankTransactionId)}},data:{status:BankTransactionStatus.RECONCILED}});
    return tx.bankReconciliation.update({where:{id},data:{status:"COMPLETED",completedAt:new Date()}});
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});}
}

export function parseBankCsv(content:string){
  try{
    const rows=parseCsv(content,{columns:true,skip_empty_lines:true,bom:true,trim:true}) as Array<Record<string,string>>;
    if(!rows.length)return [];
    const normalize=(key:string)=>key.toLowerCase().replace(/[^a-z0-9]/g,"");
    const get=(row:Record<string,string>,...keys:string[])=>{
      const entries=new Map(Object.entries(row).map(([key,value])=>[normalize(key),String(value??"").trim()]));
      for(const key of keys){const value=entries.get(normalize(key));if(value)return value;}
      return "";
    };
    const money=(raw:string)=>{
      let value=raw.trim();if(!value)return "";
      let negative=false;
      if(/^\(.*\)$/.test(value)){negative=true;value=value.slice(1,-1);}
      if(/\bDR$/i.test(value)){negative=true;value=value.replace(/\bDR$/i,"");}
      value=value.replace(/\bCR$/i,"").replace(/(?:GHS|USD|GBP|EUR|NGN|GH₵)/gi,"").replace(/[\s,$£€¥₵]/g,"");
      if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value))throw new Error(`Invalid amount: ${raw}`);
      const parsed=new Prisma.Decimal(value);
      return (negative?parsed.abs().negated():parsed).toString();
    };
    return rows.map((row)=>{
      const date=get(row,"date","transaction date","posted date","posting date","value date","dtposted");
      const description=get(row,"description","transaction description","name","payee","memo");
      const reference=get(row,"reference","check number","checknum","ref");
      const externalId=get(row,"id","external id","transaction id","fitid");
      const amountValue=get(row,"amount","transaction amount");
      const debitValue=get(row,"debit","withdrawal","money out");
      const creditValue=get(row,"credit","deposit","money in");
      let amount="";
      if(amountValue)amount=money(amountValue);
      else if(debitValue||creditValue){
        const debit=debitValue?new Prisma.Decimal(money(debitValue)):new Prisma.Decimal(0);
        const credit=creditValue?new Prisma.Decimal(money(creditValue)):new Prisma.Decimal(0);
        if(debit.gt(0)&&credit.gt(0))throw new Error("A row cannot contain both debit and credit amounts");
        if(!debit.isZero())amount=debit.abs().negated().toString();
        else if(!credit.isZero())amount=credit.abs().toString();
        else amount="0";
      }else throw new Error("CSV must contain an amount, debit, or credit column");
      return {date,description,reference:reference||undefined,externalId:externalId||undefined,amount};
    });
  }catch(error:any){throw new AppError(`Could not parse bank CSV: ${error.message}`,400);}
}
function parseOfx(content:string){const out:Array<{date:string;description:string;reference?:string;externalId?:string;amount:string}>=[];const blocks=content.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi)||[];for(const block of blocks){const value=(tag:string)=>block.match(new RegExp(`<${tag}>([^\\r\\n<]+)`,"i"))?.[1]?.trim()||"";const date=value("DTPOSTED").slice(0,8);out.push({date:date?`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`:"",description:value("NAME")||value("MEMO"),reference:value("CHECKNUM"),externalId:value("FITID"),amount:value("TRNAMT")});}return out;}
