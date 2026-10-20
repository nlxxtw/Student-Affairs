'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert'),XLSX=require('../assets/xlsx.full.min.js');
module.exports=async function verifyImportTemplates(page,output){
  fs.mkdirSync(output,{recursive:true});
  const result=await page.evaluate(async()=>{
    const blobs=[],originalCreate=URL.createObjectURL,originalRevoke=URL.revokeObjectURL,originalClick=HTMLAnchorElement.prototype.click;
    URL.createObjectURL=function(blob){blobs.push({blob});return 'blob:template-qa-'+blobs.length;};URL.revokeObjectURL=function(){};
    HTMLAnchorElement.prototype.click=function(){if(this.download&&blobs.length)blobs[blobs.length-1].name=this.download;};
    const cases=[['student',()=>stuImportTemplate()],['party',()=>partyImportTemplate()],['dorm',()=>dormImportTemplate()],...['dept','major','grade','class','enrollType','dorminfo'].map(kind=>['maint-'+kind,()=>maintImportTemplateXlsx(kind)]),['fund',()=>fundImportTemplate()],['classOfficer',()=>classOfficerImportTemplate()],['course',()=>courseScheduleImportTemplate()],['grade',()=>gradeDownloadTemplate()],['gradeCourse',()=>gradeDownloadCourseTemplate()],['academic',()=>academicDownloadTemplate()],['warning',()=>academicWarningDownloadTemplate()],['warningCourse',()=>academicWarningDownloadCourseTemplate()],['studentLoan',()=>studentLoanImportTemplate()],['employmentIntention',()=>employmentIntentionDownloadTemplate()],['employmentResource',()=>employmentResourceDownloadTemplate()],['subjectCompetition',()=>subjectCompetitionDownloadTemplate()],['counselorGrowth',()=>counselorGrowthDownloadTemplate()],['award',()=>awardStatisticsDownloadTemplate()]];
    Object.keys(DIRECT_MODULE_IMPORTS).forEach(view=>cases.push([view,()=>directImportTemplate(view)]));
    Object.keys(XCM_MODULES).forEach(view=>cases.push(['xcm-'+view,()=>xcmDownloadTemplate(view)]));
    cases.push(['customRoster',()=>customRosterTemplate()]);
    for(const view of ['student','classOfficer','dorm','counselorGrowth'])cases.push(['customFields-'+view,()=>customFieldsTemplate(view)]);
    cases.push(['custom',()=>downloadCSV('学生管理_字段导入模板',['记录ID','政治面貌','自定义选项'],[],{fixedOptions:{'政治面貌':[],'自定义选项':['选项 A','含逗号,的值','含双引号"与&符号',"含单引号'的值"]}})]);
    try{for(const [label,run]of cases){const count=blobs.length;run();if(blobs.length!==count+1)throw Error('download not generated: '+label);blobs[count].label=label;}}finally{URL.createObjectURL=originalCreate;URL.revokeObjectURL=originalRevoke;HTMLAnchorElement.prototype.click=originalClick;}
    const files=[];
    for(const item of blobs){
      const bytes=new Uint8Array(await item.blob.arrayBuffer()),zip=await smartZipEntries(bytes.buffer),parse=xml=>new DOMParser().parseFromString(xml,'application/xml');
      Object.entries(zip).filter(([name])=>/\.xml$|\.rels$/.test(name)).forEach(([name,xml])=>{if(parse(xml).querySelector('parsererror'))throw Error('Invalid XML '+item.label+' '+name);});
      const main=parse(zip['xl/worksheets/sheet1.xml']),wb=parse(zip['xl/workbook.xml']),optionSheet=zip['xl/worksheets/import-options.xml']?parse(zip['xl/worksheets/import-options.xml']):null;
      const validations=Array.from(main.getElementsByTagName('dataValidation')).map(rule=>{
        const name=rule.getElementsByTagName('formula1')[0].textContent,definition=Array.from(wb.getElementsByTagName('definedName')).find(node=>node.getAttribute('name')===name);
        if(!definition||!optionSheet)throw Error('Missing option source '+item.label);
        const source=definition.textContent,match=source.match(/!\$([A-Z]+)\$2:\$[A-Z]+\$(\d+)$/);if(!match)throw Error('Invalid defined name '+source);
        const cells=Array.from(optionSheet.getElementsByTagName('c')),values=[];
        for(let r=2;r<=Number(match[2]);r++){const cell=cells.find(node=>node.getAttribute('r')===match[1]+r);values.push(cell?cell.textContent:'');}
        const header=cells.find(node=>node.getAttribute('r')===match[1]+'1').textContent;
        return {label:header,type:rule.getAttribute('type'),errorStyle:rule.getAttribute('errorStyle'),showErrorMessage:rule.getAttribute('showErrorMessage'),showDropDown:rule.getAttribute('showDropDown'),sqref:rule.getAttribute('sqref'),values};
      });
      const pane=main.getElementsByTagName('pane')[0],sheetRows=Array.from(main.getElementsByTagName('row')),columns=Array.from(main.getElementsByTagName('col'));
      const visibleRows=sheetRows.map(row=>Array.from(row.getElementsByTagName('c')).map(cell=>cell.textContent));
      const layout={headers:visibleRows[0]||[],rows:visibleRows,xSplit:pane&&pane.getAttribute('xSplit')||'',ySplit:pane&&pane.getAttribute('ySplit')||'',topLeftCell:pane&&pane.getAttribute('topLeftCell')||'',widths:columns.map(column=>Number(column.getAttribute('width')))};
      const sheets=await smartReadWorkbook(new File([bytes],item.name));
      if(sheets.length!==1)throw Error('Option sheet was parsed as import data: '+item.label);
      files.push({label:item.label,name:item.name,bytes:Array.from(bytes),validations,layout});
    }
    const invalidStudent=stuImportEnumIssues({'政治面貌':'无效面貌','学籍状态':'无效状态','性别':'未知','民族':'无效民族','学历':'无效学历','转专业备注':'也许'});
    const before=students.length,smart=smartImportApplyPlan([{type:'student',records:[{'学号':'SHOULD_NOT_IMPORT','姓名':'拒绝导入','班级':'测试班','学籍状态':'无效状态'}]}]);
    if(students.length!==before||smart.ok!==0||!smart.failed)throw Error('Smart import did not reject invalid values');
    const exportZip=await smartZipEntries(buildXlsx('普通导出',[['性别'],['自定义历史值']]).buffer);
    const ethnicChecks=['穿青人族','其他','外国血统中国籍人士'].map(value=>{
      const form=new DOMParser().parseFromString(stuFormBody(Object.assign({},students[0],{ethnic:value})),'text/html');
      return {value,selected:form.querySelector('#fEthnic').value,optionCount:form.querySelector('#fEthnic').options.length,importErrors:stuImportEnumIssues({'民族':value}).length};
    });
    return {files,invalidStudent,ethnicChecks,exportHasValidation:exportZip['xl/worksheets/sheet1.xml'].includes('dataValidation'),enumCases:[
      ['住宿信息','住宿情况','校内','校外'],['查寝记录','卫生情况','优','干净'],['查寝记录','是否走访','否','未走访'],['党团员发展','当前阶段','发展对象','未知阶段'],['家校联系','渠道','微信','聊天'],['帮扶记录','帮扶状态','已结束','结束了'],['突发事件','类型','危机','异常事件'],['课堂管理','类型','病假','未知考勤'],['就业资源','状态','有效','可用'],['科创竞赛','状态','待核验','可用']
    ].map(([context,field,good,bad])=>({context,field,goodErrors:importEnumIssues(context,{[field]:good}).length,badErrors:importEnumIssues(context,{[field]:bad}).length})),freeTextErrors:importEnumIssues('学生管理',{'招生类别':'新招生类别','残疾情况':'按实际情况填写'}).length};
  });
  assert.strictEqual(result.invalidStudent.length,6);assert.strictEqual(result.exportHasValidation,false);assert.strictEqual(result.freeTextErrors,0);
  for(const check of result.ethnicChecks){assert.strictEqual(check.selected,check.value);assert.strictEqual(check.optionCount,59);assert.strictEqual(check.importErrors,0);}
  for(const check of result.enumCases){assert.strictEqual(check.goodErrors,0,check.context+check.field);assert.strictEqual(check.badErrors,1,check.context+check.field);}
  let count=0;for(const file of result.files){assert.strictEqual(file.layout.rows.length,2,file.label+' template must contain only the header and row 2 example');assert.ok(file.layout.rows[1].some(value=>String(value||'').trim()),file.label+' template row 2 example must not be blank');assert.ok(!file.layout.rows.flat().some(value=>/^※|使用说明|必填项|格式说明/.test(String(value||'').trim())),file.label+' template must not contain instruction text');for(const rule of file.validations){count++;assert.strictEqual(rule.type,'list');assert.strictEqual(rule.errorStyle,'stop');assert.strictEqual(rule.showErrorMessage,'1');assert.strictEqual(rule.showDropDown,'0');assert.ok(rule.sqref.endsWith('1048576'));assert.ok(rule.values.every(Boolean));}fs.writeFileSync(path.join(output,file.label+'.xlsx'),Buffer.from(file.bytes));delete file.bytes;}
  const byLabel=Object.fromEntries(result.files.map(file=>[file.label,file]));
  const studentHeaders=byLabel.student.layout.rows[0].map(value=>String(value).replace(/\s*\*\s*$/,''));
  assert.strictEqual(byLabel.student.layout.rows[1][studentHeaders.indexOf('民族')],'汉族','student template example must use the valid 汉族 enum');
  const rule=(file,label)=>byLabel[file].validations.find(rule=>rule.label===label);
  assert.ok(rule('student','政治面貌'));assert.ok(rule('student','学籍状态'));assert.ok(rule('student','学历'));assert.strictEqual(rule('student','民族').values.length,59);
  for(const value of ['穿青人族','其他','外国血统中国籍人士']){assert.ok(rule('student','民族').values.includes(value));assert.ok(rule('fund','民族').values.includes(value));}
  assert.deepStrictEqual(rule('dorm','住宿情况').values,['校内','租房','走读']);assert.strictEqual(rule('fund','是否贫困生').sqref,'I2:I1048576');
  assert.deepStrictEqual(rule('party','政治面貌').values,['中共党员','中共预备党员','共青团员','群众','其他民主党派']);
  assert.deepStrictEqual(rule('party','团员身份').values,['团员','非团员','已推优','保留团员的中共党员','退团']);
  assert.ok(rule('party','当前发展阶段'),JSON.stringify(byLabel.party));
  assert.deepStrictEqual(rule('party','当前发展阶段').values,['群众','共青团员','递交入党申请书','入党积极分子','发展对象','中共预备党员','中共党员']);
  for(const label of ['初级党课状态','中级党课状态','高级党课状态'])assert.deepStrictEqual(rule('party',label).values,['未参加','培训中','已结业','未通过']);
  assert.strictEqual(byLabel.party.layout.headers[0],'学号 *');assert.strictEqual(byLabel.party.layout.rows[1][0],'20240001');assert.strictEqual(byLabel.party.layout.xSplit,'2');assert.strictEqual(byLabel.party.layout.ySplit,'1');assert.strictEqual(byLabel.party.layout.topLeftCell,'C2');assert.strictEqual(byLabel.party.layout.widths.length,23);
  assert.strictEqual(rule('party','政治面貌').sqref,'C2:C1048576','party dropdown validation must start at the row 2 example');
  assert.strictEqual(byLabel.academic.layout.rows[1][0],'2024010101','academic template row 2 must be the example rather than a format hint');
  assert.deepStrictEqual(rule('custom','自定义选项').values,['选项 A','含逗号,的值','含双引号"与&符号',"含单引号'的值"]);assert.strictEqual(rule('custom','政治面貌'),undefined);
  assert.ok(rule('counselorGrowth','成果类别'));assert.ok(rule('counselorGrowth','级别'));assert.ok(rule('counselorGrowth','代表性成果'));
  await page.evaluate(()=>goto('studentOrgHome'));
  const orgFrame=page.frameLocator('.student-org-frame iframe');
  await orgFrame.locator('.szo-third-tabs').waitFor({state:'visible'});
  const orgTemplateKinds=['orgs','struct','task','activity','meeting','training','classroom'];
  for(const kind of orgTemplateKinds){
    const pending=page.waitForEvent('download');
    await orgFrame.locator('body').evaluate((_,value)=>downloadTemplate(value),kind);
    const download=await pending,filePath=await download.path(),workbook=XLSX.read(fs.readFileSync(filePath),{type:'buffer'});
    assert.strictEqual(workbook.SheetNames.length,1,'student organization '+kind+' template must have one data sheet');
    const rows=XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]],{header:1,defval:'',blankrows:true});
    assert.strictEqual(rows.length,2,'student organization '+kind+' template must contain only header and row 2 example');
    assert.ok(rows[1].some(value=>String(value||'').trim()),'student organization '+kind+' row 2 example must not be blank');
    assert.ok(!rows.flat().some(value=>/^※|使用说明|必填项|格式说明|导入后可|所属组织填/.test(String(value||'').trim())),'student organization '+kind+' template must not contain instruction text');
    fs.copyFileSync(filePath,path.join(output,'studentOrg-'+kind+'.xlsx'));
  }
  await page.evaluate(()=>goto('academicAnalysis'));
  const analysisFrame=page.frameLocator('#academicAnalysisFrame');
  await analysisFrame.getByRole('button',{name:'下载班主任名单模板'}).waitFor({state:'visible'});
  console.log('[import templates] academic-analysis teacher template');
  const [teacherDownload]=await Promise.all([page.waitForEvent('download'),analysisFrame.getByRole('button',{name:'下载班主任名单模板'}).click()]);
  const teacherPath=await teacherDownload.path(),teacherWorkbook=XLSX.read(fs.readFileSync(teacherPath),{type:'buffer'});
  assert.deepStrictEqual(teacherWorkbook.SheetNames,['班主任名单']);
  const teacherRows=XLSX.utils.sheet_to_json(teacherWorkbook.Sheets['班主任名单'],{header:1,defval:'',blankrows:true});
  assert.deepStrictEqual(teacherRows,[['班级','班主任'],['示例班级','示例班主任']]);
  fs.copyFileSync(teacherPath,path.join(output,'academicAnalysis-teacher.xlsx'));
  const maintenanceKinds=['dept','major','grade','class','enrollType','dorminfo'];
  for(const kind of maintenanceKinds){
    const pending=page.waitForEvent('download');
    await page.evaluate(value=>maintImportTemplate(value),kind);
    const download=await pending,filePath=await download.path(),fileName=download.suggestedFilename(),csvText=fs.readFileSync(filePath,'utf8').replace(/^\uFEFF/,'');
    assert.ok(fileName.endsWith('.csv'),'maintenance '+kind+' CSV template must use the .csv extension');
    const lines=csvText.split(/\r?\n/).filter(line=>line.trim());
    assert.strictEqual(lines.length,2,'maintenance '+kind+' CSV template must contain only header and row 2 example');
    assert.ok(!lines.some(line=>/^※|填写说明|格式说明/.test(line.trim())),'maintenance '+kind+' CSV template must not contain instruction text');
  }
  // 实际映射向导拒绝非法粘贴值，并且确认按钮不可写入。
  await page.evaluate(async()=>{openMappedImportWizard({name:'住宿信息',fields:['学号','住宿情况'],file:new File(['学号,住宿情况\nQA001,非法住宿'],'invalid.csv'),apply:()=>{throw Error('Must not apply invalid row');}});await mappedImportNext();await mappedImportNext();mappedImportNext();});
  await page.locator('#importSmartMatchLayer').waitFor({state:'visible'});
  await page.locator('#importSmartMatchLayer select').selectOption('-1');
  await page.getByRole('button',{name:'确认并应用修正'}).click();
  await page.locator('#studentLinkImportLayer').waitFor({state:'visible'});
  await page.locator('#studentLinkIdentityChoice-0').selectOption('sid');
  await page.locator('#studentLinkImportConfirm').click();
  await page.waitForFunction(()=>/住宿情况.*不在固定选项/.test(document.getElementById('modalBody').innerText));
  assert.match(await page.locator('#modalBody').innerText(),/住宿情况.*不在固定选项/);assert.strictEqual(await page.getByRole('button',{name:/确认导入/}).isDisabled(),true);await page.evaluate(()=>closeModal());
  for(const type of ['employmentResource','subjectCompetition']){
    const before=await page.evaluate(type=>{
      const resource=type==='employmentResource';
      resource?employmentResourceImport():subjectCompetitionImport();
      const transfer=new DataTransfer();transfer.items.add(new File([(resource?'资源名称':'竞赛名称')+',官方网址,状态\n非法选项测试,https://example.edu/invalid-option,无效状态'], 'invalid-status.csv',{type:'text/csv'}));
      document.getElementById(resource?'erImportFile':'scImportFile').files=transfer.files;
      if(!resource)document.querySelector('input[name="scMode"][value="replace"]').checked=true;
      return JSON.stringify(resource?employmentResourceRecords:subjectCompetitionRecords);
    },type);
    await page.locator('#modalOk').click();
    await page.locator('#importSmartMatchLayer').waitFor({state:'visible'});
    await page.locator('#importSmartMatchLayer select').selectOption('-1');
    await page.getByRole('button',{name:'确认并应用修正'}).click();
    await page.waitForTimeout(100);
    assert.strictEqual(await page.evaluate(type=>JSON.stringify(type==='employmentResource'?employmentResourceRecords:subjectCompetitionRecords),type),before,'Legacy import mutated data before rejecting invalid status');
    assert.match(await page.locator('body').innerText(),/无效状态.*不在固定选项/);
    await page.evaluate(()=>closeModal());
  }
  const savedPath=path.join(output,'excel-student.xlsx');
  if(fs.existsSync(savedPath)){
    const sheetCount=await page.evaluate(async bytes=>(await smartReadWorkbook(new File([new Uint8Array(bytes)],'excel-student.xlsx'))).length,Array.from(fs.readFileSync(savedPath)));
    assert.strictEqual(sheetCount,1,'Excel-saved hidden option sheet was mistaken for business data');
    result.excelRoundtripPassed=true;
  }
  result.count=count;fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(result,null,2),'utf8');
  console.log('Import template QA passed: '+(result.files.length+orgTemplateKinds.length+1)+' XLSX templates and '+maintenanceKinds.length+' CSV templates, '+count+' dropdown columns, enum guards and workbook readback.');
};
