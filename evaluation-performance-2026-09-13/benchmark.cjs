const fs=require('fs'),path=require('path');
process.chdir(__dirname);
require('../node_modules/ts-node').register({project:path.resolve(__dirname,'../tsconfig.json')});
Object.assign(process.env,require('../node_modules/dotenv').parse(fs.readFileSync(path.resolve(__dirname,'../.env'))));
const {chromium}=require('../node_modules/playwright');
const launchSource=process.env.BENCHMARK_PLAYWRIGHT_MODULE?require(process.env.BENCHMARK_PLAYWRIGHT_MODULE).chromium:chromium;const nativeLaunch=launchSource.launch.bind(launchSource);chromium.launch=o=>nativeLaunch({...o,headless:process.env.BENCHMARK_HEADLESS!=="false",...(process.env.BENCHMARK_BROWSER_CHANNEL?{channel:process.env.BENCHMARK_BROWSER_CHANNEL}:{})});
let current;
const labelMap={'First Name':'firstName','Last Name':'lastName','Date of Birth':'dateOfBirth','Medical ID':'medicalId','Gender':'gender','Blood Type':'bloodType','Allergies':'allergies','Current Medications':'medications','Emergency Contact Name':'emergencyContactName','Emergency Contact Phone':'emergencyContactPhone'};
const ff=require('../src/formFiller');const Original=ff.FormFiller;
ff.FormFiller=class extends Original{constructor(page){super(page);for(const name of ['fillField','selectDropdown','fillFields']){const original=this.tools[name].execute;this.tools[name].execute=async(args,opts)=>{const result=await original(args,opts);for(const field of (name==='fillFields'?args.fields:[{label:args.label,kind:name==='selectDropdown'?'dropdown':'text'}])){const key=labelMap[field.label];if(key){const actual=await (field.kind==='dropdown'?page.getByRole('combobox',{name:field.label,exact:true}).locator('option:checked').textContent():page.getByRole('textbox',{name:field.label,exact:true}).inputValue()).catch(()=>null);if(actual!==null)current.fields[key]=actual;}}return result;};}}};
const {model}=require('../src/_internal/setup');const gen=model.doGenerate.bind(model);
model.doGenerate=async options=>{const result=await gen(options);current.calls++;current.usage.push(result.usage);return result;};
const {TaskRunner}=require('../src/taskRunner');const {runBatch}=require('../src/batchRunner');
const records=JSON.parse(fs.readFileSync('records.json'));const limit=Number(process.argv[2]||2),start=Number(process.argv[3]||0);const selected=records.slice(start,start+limit);
if(!Number.isInteger(limit)||limit<1||limit>100||!Number.isInteger(start)||start<0||selected.length!==limit)throw new Error("Use a record count from 1 to 100 and a valid starting offset.");
fs.writeFileSync("rerun-attempts.jsonl","");
const rows=fs.readFileSync('patients-100.csv','utf8').trimEnd().split('\n');fs.writeFileSync('active-batch.csv',[rows[0],...rows.slice(start+1,start+limit+1)].join('\n')+'\n');
let index=0;const results=[];const runner=new TaskRunner('https://magical-medical-form.netlify.app/');
(async()=>{const batch=await runBatch(path.resolve('active-batch.csv'),async(data,runId)=>{
const input=selected.find(r=>r.medicalId===data.medicalId); if(!input) throw new Error('Unknown record');current={medicalId:input.medicalId,fields:{},usage:[],calls:0};const began=Date.now();let workflow,error;
try{workflow=await runner.run(data,runId);}catch(e){error={name:e.name,message:String(e.message).replace(/AIza[\w-]+/g,'[REDACTED]').slice(0,300)};}
const mismatches=Object.keys(input).filter(k=>(current.fields[k]??'')!==input[k]).map(k=>({field:k,expected:input[k],actual:current.fields[k]??''}));
const result={...current,durationMs:Date.now()-began,submitted:workflow?.submitted||false,exactInputMatch:mismatches.length===0,mismatches,error};results.push(result);fs.appendFileSync('rerun-attempts.jsonl',JSON.stringify(result)+'\n');console.log('EVAL',result.medicalId,result.submitted,result.exactInputMatch,result.calls);
if(error)throw new (require('../src/errors').CategorizedError)('unknown',error.message);
return workflow;
});fs.writeFileSync(`rerun-${start}-${limit}.json`,JSON.stringify({batch,results},null,2));if(results.some(r=>!r.submitted||!r.exactInputMatch))process.exitCode=1;const seconds=results.reduce((sum,r)=>sum+r.durationMs,0)/1000;console.log(`Verified ${results.filter(r=>r.submitted&&r.exactInputMatch).length}/${results.length}; processing time ${seconds.toFixed(1)} seconds (${(seconds/60).toFixed(2)} minutes). Results saved to rerun-attempts.jsonl.`);})().catch(e=>{console.error(String(e.message).slice(0,350));process.exitCode=1});




