import { FormEvent, useState } from "react";
import { FileUp, Download } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

type Entity = "CUSTOMERS" | "VENDORS" | "PRODUCTS" | "CHART_OF_ACCOUNTS" | "TRANSACTIONS";
const templates: Record<Entity, string> = {
  CUSTOMERS: "displayName,companyName,email,phone,paymentTermsDays,taxId,currency\nAmina Mensah,Adom Trading,amina@example.com,+233201234567,30,GHA-123,GHS\n",
  VENDORS: "displayName,companyName,email,phone,paymentTermsDays,taxId,currency\nSupplier Ltd,Supplier Ltd,ap@supplier.example,+233501234567,14,GHA-456,GHS\n",
  PRODUCTS: "kind,name,sku,description,salePrice,purchaseCost,incomeAccountCode,expenseAccountCode,inventoryTracking,quantityOnHand,averageCost,reorderLevel\nPRODUCT,Ground Coffee,COF-01,1kg pack,80,45,4000,5000,true,20,45,5\n",
  CHART_OF_ACCOUNTS: "code,name,type,description,parentCode,openingBalance,openingBalanceDate\n1010,Petty Cash,ASSET,Petty cash,1000,250.00,2026-01-01\n",
  TRANSACTIONS: "entry,date,accountCode,debit,credit,memo,description\nOpening journal,2026-01-01,1000,1000,0,Opening balance,Cash opening\nOpening journal,2026-01-01,3000,0,1000,Opening balance,Owner equity\n",
};
const labels: Record<Entity,string> = { CUSTOMERS:"Customers CSV", VENDORS:"Vendors CSV", PRODUCTS:"Products CSV", CHART_OF_ACCOUNTS:"Chart of Accounts CSV", TRANSACTIONS:"Transactions CSV" };
export default function CsvImportPanel({ entity, onImported }: { entity: Entity; onImported?: () => void }) {
  const { membership }=useAuth(); const [file,setFile]=useState<File|null>(null);const [busy,setBusy]=useState(false);const [result,setResult]=useState("");const [error,setError]=useState("");
  function downloadTemplate(){const blob=new Blob([templates[entity]],{type:"text/csv;charset=utf-8"});const href=URL.createObjectURL(blob);const a=document.createElement("a");a.href=href;a.download=`${entity.toLowerCase()}-template.csv`;a.click();URL.revokeObjectURL(href);}
  async function submit(event:FormEvent){event.preventDefault();if(!membership||!file)return;setBusy(true);setError("");setResult("");try{const csv=await file.text();const response=await api.post<{data:{totalRows:number;importedRows:number;rejectedRows:number;errors:Array<{row:number;message:string}>}}>(`/companies/${membership.companyId}/imports/${entity}`,csv,{params:{fileName:file.name},headers:{"Content-Type":"text/csv"}});const data=response.data.data;setResult(`Imported ${data.importedRows} of ${data.totalRows} rows; ${data.rejectedRows} rejected.`);if(data.errors.length)setError(data.errors.slice(0,5).map((e)=>`Row ${e.row}: ${e.message}`).join(" · "));onImported?.();}catch(err:any){setError(err.response?.data?.error||"Import failed.");}finally{setBusy(false);}}
  return <details className="card"><summary className="cursor-pointer font-medium text-gray-800">Import {labels[entity]}</summary><form onSubmit={submit} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"><label className="label flex-1">Choose CSV file<input type="file" accept=".csv,text/csv" onChange={(e)=>setFile(e.target.files?.[0]||null)} className="input mt-1"/></label><button type="button" onClick={downloadTemplate} className="btn-outline"><Download className="mr-2 h-4 w-4"/>Template</button><button disabled={!file||busy} className="btn-primary"><FileUp className="mr-2 h-4 w-4"/>{busy?"Importing…":"Import"}</button></form>{result&&<p className="mt-3 text-sm text-green-700">{result}</p>}{error&&<p className="mt-2 text-sm text-amber-700" role="alert">{error}</p>}<p className="mt-2 text-xs text-gray-500">CSV imports process valid rows and return row-specific failures. Max 5,000 records, 10 MB.</p></details>;
}
