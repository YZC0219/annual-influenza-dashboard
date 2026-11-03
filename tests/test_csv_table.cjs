'use strict';
const assert=require('node:assert/strict');
const {parse,decode,htmlTable}=require('../static/js/csv-table.js');
let checks=0;
function test(name,fn){fn();checks++;console.log('PASS '+name);}
test('CSV handles BOM, CRLF, quoted commas, escaped quotes and multiline values',()=>{
 const result=parse('\ufeff姓名,说明,比例\r\n张三,"第一行\n第二行,含逗号和""引号""",3.20%\r\n李四,普通,0%\r\n');
 assert.deepEqual(result.headers,['姓名','说明','比例']);assert.equal(result.rows.length,2);assert.equal(result.rows[0][1],'第一行\n第二行,含逗号和"引号"');assert.deepEqual(result.numeric,[false,false,true]);
});
test('Semicolon, tab, trailing empty columns and blank lines are supported',()=>{
 assert.equal(parse('a;b;c\n1;2;\n\n').delimiter,';');assert.deepEqual(parse('a;b;c\n1;2;').rows,[['1','2','']]);assert.equal(parse('名称\t数值\n甲\t12').delimiter,'\t');
});
test('Missing columns are padded, extra columns preserved, blank headers named',()=>{
 const result=parse('名称,,名称\n甲,1\n乙,2,3,4');assert.equal(result.headers.length,4);assert.equal(result.headers[1],'列 2');assert.equal(result.headers[2],'名称（2）');assert.deepEqual(result.rows[0],['甲','1','','']);assert.equal(result.rows[1][3],'4');assert.equal(result.uneven,2);
});
test('Headerless files retain the first record and identifiers retain leading zeroes',()=>{
 const result=parse('001,0\n002,1',false);assert.equal(result.rows.length,2);assert.deepEqual(result.numeric,[false,true]);assert.equal(result.rows[0][0],'001');assert.throws(()=>parse('a,b'),/只有表头/);
});
test('Malformed, empty and oversized dimensions are rejected without silent truncation',()=>{
 for(const input of ['', '\n\n','a,b\n"unclosed,1','a,b\n"closed"junk,1','a,b\na"b,1'])assert.throws(()=>parse(input));
 assert.throws(()=>parse(Array.from({length:101},(_,i)=>'c'+i).join(',')+'\n1'),/100 列/);
 assert.throws(()=>parse('a\n'+Array(20001).fill('1').join('\n')),/20,000/);
});
test('UTF-8, GB18030 and BOM-marked UTF-16 preserve Chinese text',()=>{
 assert.equal(decode(Buffer.from('中文')).text,'中文');assert.equal(decode(Uint8Array.from([0xd6,0xd0,0xce,0xc4])).text,'中文');
 assert.equal(decode(Buffer.concat([Buffer.from([255,254]),Buffer.from('名称,数值\n甲,1','utf16le')])).text,'名称,数值\n甲,1');
});
test('Standalone formatted export escapes untrusted headers, title and cells',()=>{
 const result=parse('名称,数值\n"<img src=x onerror=alert(1)>",12');const html=htmlTable(result,result.rows,'<script>alert(1)</script>');
 assert.ok(html.includes('&lt;img'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<img'));assert.ok(!html.includes('<script>'));assert.ok(html.includes('class="number"'));assert.ok(html.includes('<meta charset="UTF-8">'));
});
console.log(checks+'/'+checks+' CSV checks passed');
