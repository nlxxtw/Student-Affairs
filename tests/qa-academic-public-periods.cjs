'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),E=require('../academic-public-engine');
const terms=['2024-2025-1','2024-2025-2','2025-2026-1'];
const rules={thresholds:[1,2,3,4],enabled:[true,true,true,true],stage:'current',scope:'term',categories:[],rank:'original',passScore:60,cetScore:425,degreeScore:60};
const people=[{id:'a',name:'甲',cls:'班',dept:'院',major:'专业',enroll:'2024-09-01'},{id:'b',name:'乙',cls:'班',dept:'院',major:'专业',enroll:'2025-09-01'}];
const courses=terms.map((term,i)=>({id:'c'+i,sid:'a',term,code:'C'+i,name:'课程'+i,credit:i+2,category:'必修'}));
const attempts=courses.map((c,i)=>({id:'a'+i,courseId:c.id,type:'original',score:'40',scale:'百分制',status:'已出分',date:'',order:i,gpa:1}));
const state={version:1,rules,courses,attempts};
test('single, non-contiguous multiple, and all terms have separate deterministic contexts',()=>{
 const single=E.summarize(state,people,terms[2],{scope:'term'});
 const multi=E.summarize(state,people,terms[2],{scope:'multi',terms:[terms[2],terms[0]]});
 const all=E.summarize(state,people,terms[2],{scope:'all'});
 assert.equal(single.rows[0].fail,1);assert.equal(multi.rows[0].fail,2);assert.equal(all.rows[0].fail,3);
 assert.equal(multi.rows[0].failCredit,6);assert.deepEqual(multi.selection.terms,[terms[0],terms[2]]);
 assert.equal(multi.selection.key,E.summarize(state,people,terms[2],{scope:'multi',terms:[terms[0],terms[2]]}).selection.key);
 assert.equal(state.rules.scope,'term');assert.notEqual(single.selection.key,multi.selection.key);
 assert.equal(E.summarize(state,people,terms[1],{scope:'all'}).rows[0].fail,2);
});
test('enrolment excludes previous terms, and missing selected terms cannot establish clearance',()=>{
 const r=E.summarize(state,people,terms[2],{scope:'multi',terms}).rows[1];
 assert.deepEqual(r.missingTerms,[terms[2]]);assert.equal(r.warningKnown,false);
 const incomplete=E.summarize({...state,courses:courses.slice(1)},people,terms[2],{scope:'multi',terms}).rows[0];
 assert.deepEqual(incomplete.missingTerms,[terms[0]]);assert.equal(incomplete.warningKnown,false);
});
test('failed credits determine severity independently of obsolete GPA warning rules',()=>{
 const r={...rules,warningMetric:'credits',creditThresholds:[3,5,8,12],useGpa:true,gpaThresholds:[2,1.7,1.2,0.5]};
 E.validateRules(r);const row=E.summarize({...state,rules:r},people,terms[2],{scope:'all'}).rows[0];
 assert.equal(row.level,'红色预警');assert(row.reasons.some(x=>x.metric==='failCredit'));assert(!row.reasons.some(x=>x.metric==='gpa'));
 assert.throws(()=>E.validateRules({...r,creditThresholds:[3,3,8,12]}));
 assert.equal(Object.hasOwn(E.validateRules({...r,gpaThresholds:[1,2,1,0]}),'gpaThresholds'),false);
});
test('optional course-code deduplication avoids repeated credits while preserving source records',()=>{
 const repeated={...state,rules:{...rules,deduplicateCourses:true},courses:courses.map(c=>({...c,code:'SAME'}))};
 const row=E.summarize(repeated,people,terms[2],{scope:'all'}).rows[0];
 assert.equal(row.fail,1);assert.equal(row.details.length,3);assert.equal(row.details.filter(c=>c.counted).length,1);
 assert.equal(state.courses.length,3);
});
test('empty/malformed multiple ranges and unknown scope are rejected',()=>{
 for(const selection of [{scope:'multi',terms:[]},{scope:'multi',terms:['bad',terms[0]]},{scope:'multi',terms:[terms[0],terms[0]]},{scope:'oops'}]){
  assert.throws(()=>E.summarize(state,people,terms[2],selection));
 }
});
test('all-term coverage includes established semesters that have no imported courses',()=>{
 const row=E.summarize({...state,courses:[courses[0],courses[2]]},people,terms[2],{scope:'all',availableTerms:terms}).rows[0];
 assert.deepEqual(row.missingTerms,[terms[1]]);assert.equal(row.warningKnown,false);
});
test('makeup and retake resolve the source course once in a multi-term range',()=>{
 const s={...state,attempts:attempts.concat([{id:'makeup',courseId:'c0',type:'makeup',score:'70',scale:'百分制',status:'已出分',date:'2025-01-01',order:10},{id:'retake',courseId:'c1',type:'retake',score:'80',scale:'百分制',status:'已出分',date:'2026-01-01',order:11}])};
 assert.equal(E.summarize(s,people,terms[2],{scope:'multi',terms,stage:'original'}).rows[0].fail,3);
 assert.equal(E.summarize(s,people,terms[2],{scope:'multi',terms,stage:'makeup'}).rows[0].fail,2);
 assert.equal(E.summarize(s,people,terms[2],{scope:'multi',terms,stage:'current'}).rows[0].fail,1);
 assert.equal(E.summarize(s,people,terms[2],{scope:'multi',terms,stage:'current'}).rows[0].count,3);
});
