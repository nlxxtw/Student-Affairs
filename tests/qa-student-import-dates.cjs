"use strict";
const assert=require("assert"),fs=require("fs"),path=require("path"),vm=require("vm"),os=require("os");
const source=fs.readFileSync(path.join(__dirname,"..","app.js"),"utf8");
const start=source.indexOf("function studentImportDate(value){"),end=source.indexOf("function normalizeStudentImportRowByClass(row){",start);
const ctx={};vm.createContext(ctx);vm.runInContext(source.slice(start,end),ctx);
const samples=["2026年10月6日","20261006","2026-10-06","2026/10/6","2026.10.6","2026年 10月 6号","２０２６１００６","2026-10-06T00:00:00Z","2026-10-06 12:34:56",46301,46301.75,new Date(2026,9,6)];
for(const value of samples)assert.strictEqual(ctx.studentImportDate(value).value,"20261006",String(value));
for(const value of ["20260229","2026-2-30","20261301","20261000","2026","2026年10月","06/10/2026","2026-10-6T25:00:00","not a date",60])assert(ctx.studentImportDate(value).error,String(value));
assert.strictEqual(ctx.studentImportDate("2024-2-29").value,"20240229");
assert.strictEqual(ctx.studentImportDate("  ").value,"");
const {withIsolatedWorkbench}=require("./isolated-workbench-helper.cjs");
const {chromium}=require(path.join(os.homedir(),".cache","codex-runtimes","codex-primary-runtime","dependencies","node","node_modules","playwright"));
withIsolatedWorkbench(async(origin,{restart})=>{
  const auth=await fetch(origin+"/api/auth/enter",{method:"POST",headers:{"Content-Type":"application/json",Origin:origin},body:"{}"});assert(auth.ok);
  const cookie=auth.headers.get("set-cookie").split(";")[0];
  const orgs={depts:[{name:"测试学院"}],majors:[{name:"测试专业",dept:"测试学院"}],classes:[{name:"测试班",dept:"测试学院",major:"测试专业",grade:"2026级"}],grades:[{name:"2026级"}],dorms:[]};
  for(const [key,value] of [["nnuzc_orgs",orgs],["nnuzc_students",[]]]){
    const response=await fetch(origin+"/api/store/"+key,{method:"PUT",headers:{"Content-Type":"application/json",Cookie:cookie,Origin:origin},body:JSON.stringify({value:JSON.stringify(value)})});assert(response.ok);
  }
  const browser=await chromium.launch({headless:true,executablePath:path.join(process.env["ProgramFiles(x86)"],"Microsoft","Edge","Application","msedge.exe")});
  try{
    const context=await browser.newContext(),[name,value]=cookie.split("=");await context.addCookies([{name,value,url:origin}]);
    const page=await context.newPage(),errors=[];page.on("pageerror",e=>errors.push(e.message));page.on("dialog",d=>d.accept());
    await page.goto(origin,{waitUntil:"networkidle"});
    await page.evaluate(()=>{goto("student");stuImport();});
    const csv="学号,姓名,班级,学籍状态,出生日期,入学日期\nD1,日期甲,测试班,在校生,2024年2月29日,2026-10-6\nD2,日期乙,测试班,在校生,20260230,2026/10/6\nD3,日期丙,测试班,在校生,2006.1.2,46301\n";
    await page.locator("#stuImportFile").setInputFiles({name:"dates.csv",mimeType:"text/csv",buffer:Buffer.from(csv)});
    await page.getByRole("button",{name:/下一步/}).click();await page.getByRole("button",{name:/下一步/}).click();
    await page.getByRole("button",{name:/校验数据/}).click();
    await page.getByRole("button",{name:/确认导入/}).waitFor({state:"visible"});
    await page.waitForFunction(()=>document.getElementById("modalBody").textContent.includes("日期无效"));
    assert.match(await page.locator("#modalBody").innerText(),/出生日期[\s\S]*日期无效/);
    await page.getByRole("button",{name:/确认导入/}).click();
    await page.waitForFunction(()=>students.some(s=>s.id==="D3"));
    assert.deepStrictEqual(await page.evaluate(()=>students.filter(s=>/^D/.test(s.id)).map(s=>[s.id,s.birth,s.enroll])),[["D1","20240229","20261006"],["D3","20060102","20261006"]]);
    await page.evaluate(()=>closeModal());
    const guards=await page.evaluate(()=>{
      const bad={学号:"BAD",姓名:"错误日期",班级:"测试班",学籍状态:"在校生",出生日期:"2026-02-30"};
      const result=writeImportedRows([bad],"add");
      const smart=smartStudentFromRow({出生日期:"2006年1月2日",入学时间:"2026/10/6"});
      writeImportedRows([{学号:"D1",姓名:"日期甲",班级:"测试班",学籍状态:"在校生",出生日期:"2008/2/29",入学日期:"2026年10月6日"}],"cover");
      return {rejected:result===false,absent:!students.some(s=>s.id==="BAD"),smart:[smart.birth,smart.enroll],covered:students.find(s=>s.id==="D1").birth};
    });
    assert.deepStrictEqual(guards,{rejected:true,absent:true,smart:["20060102","20261006"],covered:"20080229"});
    const smartResult=await page.evaluate(()=>{
      const report=smartImportApplyPlan([{type:"student",records:[{学号:"S1",姓名:"智能日期",班级:"测试班",学籍状态:"在校生",出生日期:"2006/1/2",入学日期:"2026年10月6日"},{学号:"S2",姓名:"智能错误",班级:"测试班",学籍状态:"在校生",出生日期:"20260230"}]}]);
      const student=students.find(s=>s.id==="S1");return {ok:report.ok,skip:report.skip,errors:report.errors.join("；"),date:[student.birth,student.enroll],absent:!students.some(s=>s.id==="S2")};
    });
    assert.strictEqual(smartResult.ok,1);assert.strictEqual(smartResult.skip,1);assert.match(smartResult.errors,/出生日期.*日期无效/);assert(smartResult.absent);assert.deepStrictEqual(smartResult.date,["20060102","20261006"]);
    // Exercise real OOXML styles and both Excel epochs without touching production data.
    const excel=await page.evaluate(async()=>{
      async function read(date1904,serial){
        const files=[{name:"xl/workbook.xml",data:'<workbook><workbookPr date1904="'+date1904+'"/></workbook>'},{name:"xl/styles.xml",data:'<styleSheet><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>'},{name:"xl/worksheets/sheet1.xml",data:'<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>出生日期</t></is></c></row><row r="2"><c r="A2" s="1"><v>'+serial+'</v></c></row></sheetData></worksheet>'}];
        const rows=await parseWorkbookToRows(new File([minZipStore(files)],"date.xlsx"),["出生日期"]);
        return studentImportDate(rows[0]["出生日期"]).value;
      }
      return [await read(0,46301),await read(1,44839)];
    });assert.deepStrictEqual(excel,["20261006","20261006"]);
    await page.evaluate(()=>workbench.legacy.flushStore());await restart();
    await page.reload({waitUntil:"networkidle"});
    assert.deepStrictEqual(await page.evaluate(()=>students.filter(s=>/^D/.test(s.id)).map(s=>[s.id,s.birth,s.enroll])),[["D1","20080229","20261006"],["D3","20060102","20261006"]]);
    assert.deepStrictEqual(errors,[]);
    console.log("qa-student-import-dates: passed (date formats, calendar validation, actual CSV wizard, partial import, cover, smart/write guards, XLSX 1900/1904, restart persistence)");
  }finally{await browser.close();}
}).catch(error=>{console.error(error);process.exitCode=1;});
