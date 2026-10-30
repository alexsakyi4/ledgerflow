import { AccountType, DocumentStatus, DocumentType, Prisma } from "@prisma/client";
import { db } from "../config/db";
import { AppError } from "../middleware/error";

export const REPORT_TYPES = ["profit-and-loss","balance-sheet","cash-flow","ar-aging","ap-aging","general-ledger","trial-balance","transaction-detail","sales-by-customer","expenses-by-vendor","sales-by-product","sales-tax-liability","fx-revaluation","realized-fx","purchase-tax-credit"] as const;
export type ReportType = typeof REPORT_TYPES[number];
const cashSources = ["CUSTOMER_PAYMENT","VENDOR_PAYMENT","SALES_RECEIPT","EXPENSE","BANK_MATCH","BANK_SPLIT","TRANSFER","CREDIT_MEMO","VENDOR_CREDIT"];
const debitNormal = (type:AccountType)=>([AccountType.ASSET,AccountType.EXPENSE,AccountType.COGS] as AccountType[]).includes(type);
const openingDebitNet = (accounts:Array<{type:AccountType;openingBalance:Prisma.Decimal;openingBalanceDate:Date|null}>,asOf:Date)=>accounts.reduce((sum,account)=>{const opening=account.openingBalanceDate&&account.openingBalanceDate>asOf?new Prisma.Decimal(0):new Prisma.Decimal(account.openingBalance);return sum.plus(debitNormal(account.type)?opening:opening.negated());},new Prisma.Decimal(0));

export class ReportService {
  static async run(companyId:string,type:ReportType,from?:Date,to?:Date,method:"accrual"|"cash"="accrual") {
    const pointInTime = type==="balance-sheet"||type==="trial-balance";
    const dateWhere = pointInTime ? {date:{lte:to||new Date()}} : from||to ? {date:{...(from?{gte:from}:{}),...(to?{lte:to}:{})}} : {};
    if(type==="ar-aging"||type==="ap-aging")return this.aging(companyId,type,to||new Date());
    if(type==="fx-revaluation")return this.fxRevaluation(companyId,to||new Date());
    if(type==="realized-fx")return this.realizedFx(companyId,from,to);
    if(type==="sales-by-customer"||type==="sales-by-product"||type==="expenses-by-vendor")return this.salesAnalysis(companyId,type,from,to);
    const cashBasisProfitLoss=type==="profit-and-loss"&&method==="cash";
    const entries:any[]=await db.journalEntry.findMany({where:{companyId,status:"POSTED",...dateWhere,...(cashBasisProfitLoss?{sourceType:{in:cashSources}}:{})},include:{lines:{include:{account:true}},createdBy:{select:{email:true}}},orderBy:[{date:"asc"},{createdAt:"asc"}]});
    if(cashBasisProfitLoss)entries.push(...await this.cashBasisAllocations(companyId,from,to));
    if(type==="general-ledger"||type==="transaction-detail")return{reportType:type,from,to,method,rows:entries.flatMap((entry:any)=>entry.lines.map((line:any)=>({date:entry.date,reference:entry.reference,memo:entry.memo,accountCode:line.account.code,accountName:line.account.name,accountType:line.account.type,description:line.description,debit:line.debit.toString(),credit:line.credit.toString(),createdBy:entry.createdBy.email}))) };
    const accounts=await db.account.findMany({where:{companyId,isActive:true},orderBy:{code:"asc"}});
    const totals=new Map<string,{debit:Prisma.Decimal;credit:Prisma.Decimal}>();
    for(const entry of entries)for(const line of entry.lines){const t=totals.get(line.accountId)||{debit:new Prisma.Decimal(0),credit:new Prisma.Decimal(0)};t.debit=t.debit.plus(line.debit);t.credit=t.credit.plus(line.credit);totals.set(line.accountId,t);}
    if(type==="trial-balance"){
      const asOf=to||new Date();
      const rows=accounts.map(account=>{const t=totals.get(account.id)||{debit:new Prisma.Decimal(0),credit:new Prisma.Decimal(0)};const opening=account.openingBalanceDate&&account.openingBalanceDate>asOf?new Prisma.Decimal(0):new Prisma.Decimal(account.openingBalance);const actual=debitNormal(account.type)?opening.plus(t.debit).minus(t.credit):opening.negated().plus(t.debit).minus(t.credit);return{code:account.code,name:account.name,type:account.type,debit:actual.gt(0)?actual.toFixed(2):"0.00",credit:actual.isNegative()?actual.abs().toFixed(2):"0.00"};});
      const openingAdjustment=openingDebitNet(accounts,asOf);
      if(!openingAdjustment.isZero())rows.push({code:"—",name:"Opening balance equity adjustment",type:AccountType.EQUITY,debit:openingAdjustment.isNegative()?openingAdjustment.abs().toFixed(2):"0.00",credit:openingAdjustment.gt(0)?openingAdjustment.toFixed(2):"0.00"});
      const debit=rows.reduce((sum,row)=>sum+Number(row.debit),0),credit=rows.reduce((sum,row)=>sum+Number(row.credit),0);return{reportType:type,asOf,method,rows,totals:{debit:debit.toFixed(2),credit:credit.toFixed(2),balanced:Math.abs(debit-credit)<0.005}};
    }
    if(type==="profit-and-loss"){
      const rows=accounts.filter(a=>([AccountType.INCOME,AccountType.EXPENSE,AccountType.COGS] as AccountType[]).includes(a.type)).map(account=>{const t=totals.get(account.id)||{debit:new Prisma.Decimal(0),credit:new Prisma.Decimal(0)};const value=account.type===AccountType.INCOME?t.credit.minus(t.debit):t.debit.minus(t.credit);return{code:account.code,name:account.name,type:account.type,amount:value.toFixed(2)};}).filter(row=>Number(row.amount)!==0);
      const income=rows.filter(r=>r.type===AccountType.INCOME).reduce((s,r)=>s+Number(r.amount),0);const expense=rows.filter(r=>r.type!==AccountType.INCOME).reduce((s,r)=>s+Number(r.amount),0);return{reportType:type,from,to,method,rows,totals:{income:income.toFixed(2),expenses:expense.toFixed(2),netProfit:(income-expense).toFixed(2)}};
    }
    if(type==="balance-sheet"){
      const asOf=to||new Date();
      const company=await db.company.findUniqueOrThrow({where:{id:companyId},select:{fiscalYearStart:true,currency:true}});
      const startYear=asOf.getUTCMonth()+1>=company.fiscalYearStart?asOf.getUTCFullYear():asOf.getUTCFullYear()-1;
      const fiscalStart=new Date(Date.UTC(startYear,company.fiscalYearStart-1,1));
      const rows=accounts.filter(a=>([AccountType.ASSET,AccountType.LIABILITY,AccountType.EQUITY] as AccountType[]).includes(a.type)).map(account=>{const t=totals.get(account.id)||{debit:new Prisma.Decimal(0),credit:new Prisma.Decimal(0)};const opening=account.openingBalanceDate&&account.openingBalanceDate>asOf?new Prisma.Decimal(0):new Prisma.Decimal(account.openingBalance);const value=debitNormal(account.type)?opening.plus(t.debit).minus(t.credit):opening.plus(t.credit).minus(t.debit);return{code:account.code,name:account.name,type:account.type,amount:value.toFixed(2)};});
      const openingAdjustment=openingDebitNet(accounts,asOf);
      if(!openingAdjustment.isZero())rows.push({code:"—",name:"Opening balance equity adjustment",type:AccountType.EQUITY,amount:openingAdjustment.toFixed(2)});
      let currentEarnings=new Prisma.Decimal(0);
      for(const entry of entries.filter(item=>item.date>=fiscalStart))for(const line of entry.lines){if(line.account.type===AccountType.INCOME)currentEarnings=currentEarnings.plus(line.credit).minus(line.debit);else if(([AccountType.EXPENSE,AccountType.COGS] as AccountType[]).includes(line.account.type))currentEarnings=currentEarnings.minus(line.debit).plus(line.credit);}
      if(!currentEarnings.isZero())rows.push({code:"—",name:"Current year earnings",type:AccountType.EQUITY,amount:currentEarnings.toFixed(2)});
      const sum=(types:AccountType[])=>rows.filter(r=>types.includes(r.type)).reduce((s,r)=>s+Number(r.amount),0);const assets=sum([AccountType.ASSET]),liabilities=sum([AccountType.LIABILITY]),equity=sum([AccountType.EQUITY]);return{reportType:type,asOf,homeCurrency:company.currency,rows,totals:{assets:assets.toFixed(2),liabilities:liabilities.toFixed(2),equity:equity.toFixed(2),liabilitiesAndEquity:(liabilities+equity).toFixed(2)}};
    }
    if(type==="sales-tax-liability"){
      const taxMap=new Map<string,{code:string;name:string;amount:number}>();
      for(const entry of entries)for(const line of entry.lines){if(line.account.code==="2200"||line.account.name.toLowerCase().includes("tax payable")||line.description?.toLowerCase().includes("sales tax")){ const current=taxMap.get(line.accountId)||{code:line.account.code,name:line.account.name,amount:0};current.amount+=Number(line.credit)-Number(line.debit);taxMap.set(line.accountId,current);}}
      const rows=Array.from(taxMap.values()).map(row=>({...row,amount:row.amount.toFixed(2)}));
      return{reportType:type,from,to,method,rows,totals:{taxLiability:rows.reduce((s,r)=>s+Number(r.amount),0).toFixed(2)}};
    }
    if(type==="purchase-tax-credit"){
      const taxMap=new Map<string,{code:string;name:string;amount:number}>();
      for(const entry of entries)for(const line of entry.lines){if(line.account.code==="1350"||line.account.name.toLowerCase().includes("input tax")||line.description?.toLowerCase().includes("input tax")){const current=taxMap.get(line.accountId)||{code:line.account.code,name:line.account.name,amount:0};current.amount+=Number(line.debit)-Number(line.credit);taxMap.set(line.accountId,current);}}
      const rows=Array.from(taxMap.values()).map(row=>({...row,amount:row.amount.toFixed(2)}));
      return{reportType:type,from,to,method,rows,totals:{purchaseTaxCredit:rows.reduce((sum,row)=>sum+Number(row.amount),0).toFixed(2)}};
    }
    if(type==="cash-flow"){
      const bankAccounts=await db.bankAccount.findMany({where:{companyId,isActive:true},select:{accountId:true}});
      const cashIds=new Set([...accounts.filter(a=>a.code.startsWith("10")||a.name.toLowerCase().includes("bank")||a.name.toLowerCase().includes("cash")).map(a=>a.id),...bankAccounts.map(a=>a.accountId)]);
      const rows=entries.flatMap((entry:any)=>entry.lines.filter((line:any)=>cashIds.has(line.accountId)).map((line:any)=>({date:entry.date,reference:entry.reference,memo:entry.memo,account:line.account.name,amount:line.debit.minus(line.credit).toFixed(2)})));
      const net=rows.reduce((s,r)=>s+Number(r.amount),0);
      return{reportType:type,from,to,method,rows,totals:{netCashChange:net.toFixed(2)}};
    }
    throw new AppError("Unknown report",404);
  }

  private static async cashBasisAllocations(companyId:string,from?:Date,to?:Date) {
    const dateWhere=from||to?{...(from?{gte:from}:{}),...(to?{lte:to}:{})}:{};
    const [payments,bankMatches,company]=await Promise.all([
      db.businessDocument.findMany({where:{companyId,type:{in:[DocumentType.CUSTOMER_PAYMENT,DocumentType.VENDOR_PAYMENT]},status:DocumentStatus.PAID,...(Object.keys(dateWhere).length?{issueDate:dateWhere}:{})}}),
      db.bankTransaction.findMany({where:{companyId,status:{in:["MATCHED","RECONCILED"]},matchedDocumentId:{not:null},...(Object.keys(dateWhere).length?{transactionDate:dateWhere}:{})}}),
      db.company.findUniqueOrThrow({where:{id:companyId},select:{currency:true}}),
    ]);
    const targetIds=new Set<string>();
    for(const payment of payments)if(Array.isArray(payment.lineItems))for(const item of payment.lineItems as any[])if(item.documentId||item.invoiceId)targetIds.add(item.documentId||item.invoiceId);
    for(const row of bankMatches)if(row.matchedDocumentId)targetIds.add(row.matchedDocumentId);
    const targets=await db.businessDocument.findMany({where:{companyId,id:{in:Array.from(targetIds)}}});
    const targetMap=new Map(targets.map((target)=>[target.id,target]));
    const linesByEntry:any[]=[];
    const appendAllocation=(target:any,amount:Prisma.Decimal,date:Date,reference:string|null,memo:string|null)=>{
      if(!target||!([DocumentType.INVOICE,DocumentType.BILL] as DocumentType[]).includes(target.type)||!new Prisma.Decimal(target.total).gt(0))return;
      const ratio=amount.div(target.total);
      if(!ratio.gt(0))return;
      const result:any[]=[];
      const items=Array.isArray(target.lineItems)?target.lineItems as any[]:[];
      for(const item of items){
        const net=new Prisma.Decimal(item.homeNet??item.net??0).mul(ratio).toDecimalPlaces(4,Prisma.Decimal.ROUND_HALF_UP);
        if(target.type===DocumentType.INVOICE){
          if(net.gt(0))result.push({accountId:item.accountId,debit:0,credit:net});
          if(item.inventoryTracking){const cogs=new Prisma.Decimal(item.averageCost||0).mul(item.quantity||0).mul(ratio).toDecimalPlaces(4,Prisma.Decimal.ROUND_HALF_UP);if(cogs.gt(0))result.push({accountId:"__COGS__",debit:cogs,credit:0});}
        }else if(item.accountId){
          const accountType=accountsById.get(item.accountId);
          if(([AccountType.EXPENSE,AccountType.COGS] as AccountType[]).includes(accountType as AccountType)&&net.gt(0))result.push({accountId:item.accountId,debit:net,credit:0});
        }
      }
      if(result.length)linesByEntry.push({date,reference,memo,lines:result});
    };
    const accountIds=new Set<string>();
    for(const target of targets)for(const item of Array.isArray(target.lineItems)?target.lineItems as any[]:[])if(item.accountId)accountIds.add(item.accountId);
    const accounts=await db.account.findMany({where:{companyId,id:{in:Array.from(accountIds)}},select:{id:true,type:true}});
    const accountsById=new Map(accounts.map((account)=>[account.id,account.type]));
    const cogsAccount=await db.account.findFirst({where:{companyId,code:"5000",isActive:true},select:{id:true}});
    for(const payment of payments){
      for(const item of Array.isArray(payment.lineItems)?payment.lineItems as any[]:[]){const target=targetMap.get(item.documentId||item.invoiceId);if(target)appendAllocation(target,new Prisma.Decimal(item.amount||0),payment.issueDate,payment.number,payment.memo);}
    }
    for(const row of bankMatches){
      if(!row.matchedDocumentId)continue;const target=targetMap.get(row.matchedDocumentId);if(!target)continue;
      let rate=new Prisma.Decimal(1);
      if(target.currency!==company.currency){const direct=await db.currencyRate.findFirst({where:{companyId,baseCurrency:target.currency,quoteCurrency:company.currency,rateDate:{lte:row.transactionDate}},orderBy:{rateDate:"desc"}});if(direct)rate=new Prisma.Decimal(direct.rate);else{const inverse=await db.currencyRate.findFirst({where:{companyId,baseCurrency:company.currency,quoteCurrency:target.currency,rateDate:{lte:row.transactionDate}},orderBy:{rateDate:"desc"}});if(!inverse||new Prisma.Decimal(inverse.rate).isZero())continue;rate=new Prisma.Decimal(1).div(inverse.rate);}}
      appendAllocation(target,row.amount.abs().div(rate).toDecimalPlaces(4,Prisma.Decimal.ROUND_HALF_UP),row.transactionDate,row.reference,row.description);
    }
    const cogsId=cogsAccount?.id;
    return linesByEntry.map((entry)=>({date:entry.date,reference:entry.reference,memo:entry.memo,lines:entry.lines.map((line:any)=>({accountId:line.accountId==="__COGS__"?(cogsId||line.accountId):line.accountId,debit:line.debit,credit:line.credit}))})).filter(entry=>entry.lines.every((line:any)=>line.accountId!=="__COGS__"));
  }

  private static async fxRevaluation(companyId: string, asOf: Date) {
    const company = await db.company.findUniqueOrThrow({ where: { id: companyId }, select: { currency: true } });
    const docs = await db.businessDocument.findMany({
      where: { companyId, type: { in: [DocumentType.INVOICE, DocumentType.BILL] }, status: { in: [DocumentStatus.SENT, DocumentStatus.APPROVED, DocumentStatus.PARTIALLY_PAID, DocumentStatus.OVERDUE] }, issueDate: { lte: asOf } },
      include: { contact: { select: { displayName: true } } }, orderBy: { dueDate: "asc" },
    });
    const rows: any[] = [];
    for (const doc of docs) {
      const foreignBalance = new Prisma.Decimal(doc.total).minus(doc.amountPaid);
      if (!foreignBalance.gt(0)) continue;
      const originalRate = doc.exchangeRate.isZero() ? new Prisma.Decimal(1) : new Prisma.Decimal(doc.exchangeRate);
      let currentRate: Prisma.Decimal | null = null;
      if (doc.currency === company.currency) currentRate = new Prisma.Decimal(1);
      else {
        const direct = await db.currencyRate.findFirst({ where: { companyId, baseCurrency: doc.currency, quoteCurrency: company.currency, rateDate: { lte: asOf } }, orderBy: { rateDate: "desc" } });
        if (direct) currentRate = new Prisma.Decimal(direct.rate);
        else {
          const inverse = await db.currencyRate.findFirst({ where: { companyId, baseCurrency: company.currency, quoteCurrency: doc.currency, rateDate: { lte: asOf } }, orderBy: { rateDate: "desc" } });
          if (inverse && !new Prisma.Decimal(inverse.rate).isZero()) currentRate = new Prisma.Decimal(1).div(inverse.rate);
        }
      }
      const carryingHome = foreignBalance.mul(originalRate).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      const currentHome = currentRate ? foreignBalance.mul(currentRate).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP) : null;
      const delta = currentHome ? currentHome.minus(carryingHome) : null;
      const isReceivable = doc.type === DocumentType.INVOICE;
      const gain = delta ? ((isReceivable ? delta : delta.negated()).gt(0) ? (isReceivable ? delta : delta.negated()) : new Prisma.Decimal(0)) : null;
      const loss = delta ? ((isReceivable ? delta.negated() : delta).gt(0) ? (isReceivable ? delta.negated() : delta) : new Prisma.Decimal(0)) : null;
      rows.push({ number: doc.number, type: doc.type, contact: doc.contact?.displayName || "—", currency: doc.currency, foreignBalance: foreignBalance.toFixed(2), originalRate: originalRate.toFixed(8), currentRate: currentRate?.toFixed(8) ?? null, carryingHome: carryingHome.toFixed(2), currentHome: currentHome?.toFixed(2) ?? null, unrealizedGain: gain?.toFixed(2) ?? null, unrealizedLoss: loss?.toFixed(2) ?? null, rateMissing: !currentRate });
    }
    const sum = (key: "carryingHome" | "currentHome" | "unrealizedGain" | "unrealizedLoss") => rows.reduce((total, row) => total + Number(row[key] || 0), 0).toFixed(2);
    return { reportType: "fx-revaluation", asOf, homeCurrency: company.currency, rows, totals: { carryingHome: sum("carryingHome"), currentHome: sum("currentHome"), unrealizedGain: sum("unrealizedGain"), unrealizedLoss: sum("unrealizedLoss"), rateMissingCount: rows.filter((row) => row.rateMissing).length } };
  }

  private static async realizedFx(companyId: string, from?: Date, to?: Date) {
    const entries = await db.journalEntry.findMany({ where: { companyId, status: "POSTED", ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}) }, include: { lines: { include: { account: true } } }, orderBy: [{ date: "asc" }, { createdAt: "asc" }] });
    const rows: any[] = [];
    let gain = new Prisma.Decimal(0), loss = new Prisma.Decimal(0);
    for (const entry of entries) for (const line of entry.lines.filter((item) => ["4300", "6800"].includes(item.account.code))) {
      const isGain = line.account.code === "4300";
      const amount = (isGain ? line.credit.minus(line.debit) : line.debit.minus(line.credit)).abs();
      if (isGain) gain = gain.plus(amount); else loss = loss.plus(amount);
      rows.push({ date: entry.date, reference: entry.reference, memo: entry.memo, accountCode: line.account.code, accountName: line.account.name, type: isGain ? "GAIN" : "LOSS", amount: amount.toFixed(2) });
    }
    return { reportType: "realized-fx", from, to, rows, totals: { gains: gain.toFixed(2), losses: loss.toFixed(2), netGain: gain.minus(loss).toFixed(2) } };
  }

  private static async aging(companyId:string,type:"ar-aging"|"ap-aging",asOf:Date){
    const docTypes=type==="ar-aging"?[DocumentType.INVOICE,DocumentType.CREDIT_MEMO]:[DocumentType.BILL,DocumentType.VENDOR_CREDIT];
    const [company,docs]=await Promise.all([db.company.findUniqueOrThrow({where:{id:companyId},select:{currency:true}}),db.businessDocument.findMany({where:{companyId,type:{in:docTypes},status:{notIn:[DocumentStatus.VOID,DocumentStatus.PAID,DocumentStatus.DRAFT]},issueDate:{lte:asOf}},include:{contact:{select:{id:true,displayName:true}}},orderBy:{dueDate:"asc"}})]);
    const rows=docs.map(doc=>{const due=doc.dueDate||doc.issueDate;const days=Math.max(0,Math.floor((asOf.getTime()-due.getTime())/86400000));const foreign=new Prisma.Decimal(doc.total).minus(doc.amountPaid);const rate=doc.exchangeRate.isZero()?new Prisma.Decimal(1):new Prisma.Decimal(doc.exchangeRate);const direction=([DocumentType.CREDIT_MEMO,DocumentType.VENDOR_CREDIT] as DocumentType[]).includes(doc.type)?-1:1;const outstanding=foreign.mul(rate).mul(direction);return{number:doc.number,type:doc.type,contact:doc.contact?.displayName||"—",issueDate:doc.issueDate,dueDate:doc.dueDate,currency:doc.currency,foreignOutstanding:foreign.mul(direction).toFixed(2),homeCurrency:company.currency,outstanding:outstanding.toFixed(2),current:days===0?outstanding.toFixed(2):"0.00",days1to30:days>0&&days<=30?outstanding.toFixed(2):"0.00",days31to60:days>30&&days<=60?outstanding.toFixed(2):"0.00",days61to90:days>60&&days<=90?outstanding.toFixed(2):"0.00",daysOver90:days>90?outstanding.toFixed(2):"0.00"};});return{reportType:type,asOf,homeCurrency:company.currency,rows,totals:{outstanding:rows.reduce((s,r)=>s+Number(r.outstanding),0).toFixed(2)}};
  }

  private static async salesAnalysis(companyId:string,type:"sales-by-customer"|"sales-by-product"|"expenses-by-vendor",from?:Date,to?:Date){
    const sales=type!=="expenses-by-vendor";
    const docTypes=sales?[DocumentType.INVOICE,DocumentType.SALES_RECEIPT,DocumentType.CREDIT_MEMO]:[DocumentType.BILL,DocumentType.EXPENSE,DocumentType.VENDOR_CREDIT];
    const [company,docs]=await Promise.all([
      db.company.findUniqueOrThrow({where:{id:companyId},select:{currency:true}}),
      db.businessDocument.findMany({where:{companyId,type:{in:docTypes},status:{notIn:[DocumentStatus.VOID,DocumentStatus.DRAFT]},...(from||to?{issueDate:{...(from?{gte:from}:{}),...(to?{lte:to}:{})}}:{})},include:{contact:{select:{id:true,displayName:true}}}}),
    ]);
    const map=new Map<string,{label:string;amount:number;count:number}>();
    for(const doc of docs){
      const sign=([DocumentType.CREDIT_MEMO,DocumentType.VENDOR_CREDIT] as DocumentType[]).includes(doc.type)?-1:1;
      if(type==="sales-by-product"){
        const lines=Array.isArray(doc.lineItems)?doc.lineItems as any[]:[];
        for(const line of lines){const key=line.productId||line.description;const current=map.get(key)||{label:line.description,amount:0,count:0};current.amount+=sign*Number(line.homeTotal??line.total??0);current.count+=Number(line.quantity||1);map.set(key,current);}
      }else{
        const key=doc.contactId||"unknown";const current=map.get(key)||{label:doc.contact?.displayName||"Unassigned",amount:0,count:0};const homeTotal=doc.homeCurrencyTotal.isZero()?new Prisma.Decimal(doc.total).mul(doc.exchangeRate):doc.homeCurrencyTotal;current.amount+=sign*Number(homeTotal);current.count+=1;map.set(key,current);
      }
    }
    const rows=Array.from(map.values()).sort((a,b)=>b.amount-a.amount).map(row=>({...row,amount:row.amount.toFixed(2)}));
    return{reportType:type,from,to,homeCurrency:company.currency,rows,totals:{amount:rows.reduce((sum,row)=>sum+Number(row.amount),0).toFixed(2),transactions:docs.length}};
  }
}
