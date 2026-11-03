'use strict';
const assert=require('node:assert/strict'),{parse}=require('../static/js/csv-table.js'),{defaults,build}=require('../static/js/csv-chart.js');
let count=0;function test(name,fn){fn();count++;console.log('PASS '+name);}
test('Monthly sample picks rate and combined year-month labels',()=>{const m=parse('year,month,rate\n2023,1,5.2\n2024,1,6.2');const d=defaults(m);assert.equal(d.metric,2);assert.equal(d.category,'period');const r=build(m,{...d,aggregation:'records'});assert.deepEqual(r.entries.map(e=>e.label),['2023-01','2024-01']);assert.equal(r.mean,5.7);});
test('Numeric metric detection prefers measures over identifiers',()=>{const m=parse('编号,名称,数量\n001,甲,0\n002,乙,5');const d=defaults(m);assert.equal(d.metric,2);assert.equal(d.category,'0');assert.equal(build(m,{...d}).entries[0].value,0);});
test('Year and text filters affect graph and narrative statistics together',()=>{const m=parse('year,month,rate\n2023,1,1\n2024,1,5\n2024,2,8');const d=defaults(m);const r=build(m,{...d,year:'2024',query:'8'});assert.equal(r.rows,1);assert.equal(r.mean,8);assert.equal(r.max.label,'2024-02');});
test('Duplicate categories remain individual unless aggregation explicitly selected',()=>{const m=parse('name,value\n甲,2\n甲,8\n乙,-4');const d=defaults(m);assert.equal(build(m,{...d}).entries.length,3);const mean=build(m,{...d,aggregation:'mean',order:'desc'});assert.equal(mean.entries[0].value,5);assert.equal(mean.min.value,-4);assert.equal(build(m,{...d,aggregation:'sum'}).max.value,10);});
test('Missing stays absent, zero remains present and empty states have no fake readings',()=>{const m=parse('name,value\n甲,\n乙,0');const r=build(m,{...defaults(m)});assert.equal(r.missing,1);assert.equal(r.entries.length,1);assert.equal(r.mean,0);const empty=build(m,{...defaults(m),query:'不存在'});assert.equal(empty.mean,null);assert.equal(empty.max,null);const text=parse('名称,说明\n甲,备注');assert.equal(defaults(text).metric,-1);assert.equal(build(text,{...defaults(text)}).entries.length,0);});
test('Sorting handles negatives, keeps all entries and leaves source records unchanged',()=>{const m=parse('name,value\n甲,-2\n乙,6\n丙,0');const original=JSON.stringify(m.rows);assert.deepEqual(build(m,{...defaults(m),order:'asc'}).entries.map(e=>e.value),[-2,0,6]);assert.equal(JSON.stringify(m.rows),original);});
test('Narrative recomputes from changed files, filters, constant values and missing records',()=>{
 const {describe}=require('../static/js/csv-chart.js');
 function text(csv,query){const m=parse(csv),r=build(m,{...defaults(m),query:query||''});return describe(r,'数量','records').map(n=>n.join('：')).join('\n');}
 const first=text('名称,数量\n甲,2\n乙,8');assert.ok(first.includes('乙 的数量为 8'));assert.ok(first.includes('平均值为 5'));
 const second=text('名称,数量\n丙,30\n丁,10');assert.ok(second.includes('丙 的数量为 30'));assert.ok(second.includes('平均值为 20'));assert.ok(!second.includes('乙'));
 assert.ok(text('名称,数量\n丙,30\n丁,10','丁').includes('仅有 1 个'));
 assert.ok(text('名称,数量\n甲,0\n乙,0').includes('数值一致'));
 assert.ok(text('名称,数量\n甲,\n乙,0').includes('未按零值填充'));
 assert.ok(text('名称,数量\n甲,3','没有匹配').includes('暂无有效数值'));
});

console.log(count+'/'+count+' CSV chart checks passed');
