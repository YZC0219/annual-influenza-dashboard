/* Local CSV table studio. No network requests, dependencies or persistent storage. */
(function (root) {
  'use strict';
  var MAX_ROWS = 20000, MAX_COLS = 100;
  function delimiterOf(text) {
    var counts = {',':0, ';':0, '\t':0}, quoted = false;
    for (var i=0;i<text.length;i++) {
      var ch=text[i];
      if(ch==='"'){if(quoted&&text[i+1]==='"')i++;else quoted=!quoted;}
      else if(!quoted){if(ch==='\n'||ch==='\r')break;if(ch in counts)counts[ch]++;}
    }
    return Object.keys(counts).sort(function(a,b){return counts[b]-counts[a];})[0];
  }
  function parse(text, header) {
    text=String(text).replace(/^\uFEFF/,'');
    if(!text.trim())throw new Error('文件为空，请选择包含数据的 CSV。');
    var delimiter=delimiterOf(text), rows=[], row=[], cell='', quoted=false, closed=false;
    function pushCell(){row.push(cell);cell='';closed=false;if(row.length>MAX_COLS)throw new Error('最多支持 100 列，请拆分文件后再导入。');}
    function pushRow(){pushCell();if(row.some(function(v){return v.trim()!=='';}))rows.push(row);row=[];if(rows.length>MAX_ROWS+1)throw new Error('最多支持 20,000 条数据，请拆分文件后再导入。');}
    for(var i=0;i<text.length;i++){
      var ch=text[i];
      if(quoted){if(ch==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=ch;}
      else if(ch===delimiter)pushCell();
      else if(ch==='\r'||ch==='\n'){if(ch==='\r'&&text[i+1]==='\n')i++;pushRow();}
      else if(ch==='"'){if(cell.trim()||closed)throw new Error('第 '+(rows.length+1)+' 条记录的引号格式不正确。');cell='';quoted=true;}
      else if(closed){if(ch!==' '&&ch!=='\t')throw new Error('引号闭合后出现了多余字符，请检查 CSV 格式。');}
      else cell+=ch;
    }
    if(quoted)throw new Error('存在未闭合的双引号，请检查文件后重新导入。');
    if(cell||row.length||closed)pushRow();
    if(!rows.length)throw new Error('文件中没有可用数据。');
    var original=header!==false?rows.shift():[], width=Math.max(original.length,rows.reduce(function(n,r){return Math.max(n,r.length);},0));
    if(!rows.length)throw new Error('文件只有表头，没有数据行。若首行也是数据，请取消“首行为表头”。');
    if(rows.length>MAX_ROWS)throw new Error('最多支持 20,000 条数据，请拆分文件后再导入。');
    var seen=Object.create(null), headers=Array.from({length:width},function(_,index){var name=(original[index]||'').trim()||'列 '+(index+1);seen[name]=(seen[name]||0)+1;return name+(seen[name]>1?'（'+seen[name]+'）':'');});
    var uneven=rows.filter(function(r){return r.length!==(original.length||width);}).length;
    rows=rows.map(function(r){return Array.from({length:width},function(_,index){return r[index]||'';});});
    var numeric=headers.map(function(_,index){var values=rows.map(function(r){return r[index].trim();}).filter(Boolean);return values.length>0&&values.every(isNumeric);});
    return {headers:headers, rows:rows, numeric:numeric, delimiter:delimiter, uneven:uneven};
  }
  function isNumeric(value){return !/^[-+]?0\d/.test(value)&&/^[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?%?$/.test(value);}
  function numericValue(value){return Number(value.trim().replace(/,/g,'').replace(/%$/,''));}
  function decode(buffer, encoding){
    var bytes=new Uint8Array(buffer), chosen=encoding||'auto';
    if(chosen==='auto'){
      if(bytes[0]===255&&bytes[1]===254)chosen='utf-16le';
      else if(bytes[0]===254&&bytes[1]===255)chosen='utf-16be';
      else {try{return {text:new TextDecoder('utf-8',{fatal:true}).decode(bytes),encoding:'UTF-8'};}catch(_){chosen='gb18030';}}
    }
    return {text:new TextDecoder(chosen,{fatal:true}).decode(bytes),encoding:chosen.toUpperCase()};
  }
  function escape(value){return String(value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function htmlTable(model, rows, title){
    return '<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+escape(title)+'</title><style>body{margin:32px;background:#f3f0e7;color:#253d36;font:14px/1.8 "Microsoft YaHei",sans-serif}h1{font:28px SimSun,serif}p{color:#596f5e}.wrap{overflow:auto}table{border-collapse:collapse;width:100%;table-layout:fixed;min-width:'+Math.max(600,model.headers.length*150)+'px;background:#faf8f1}th,td{padding:12px 16px;border:1px solid #d0d4c8;text-align:left;vertical-align:top;min-width:8ch;max-width:36ch;overflow-wrap:anywhere;white-space:pre-wrap}th{background:#e4e9dc}tbody tr:nth-child(even){background:#f0f1e8}.number{text-align:right;font-variant-numeric:tabular-nums}@media print{body{margin:0;background:white}thead{display:table-header-group}tr{break-inside:avoid}.wrap{overflow:visible}th,td{min-width:0;padding:6px}}</style><h1>'+escape(title)+'</h1><p>'+rows.length+' 条记录 · '+model.headers.length+' 列 · 流感观测站 CSV 排表</p><div class="wrap"><table><thead><tr>'+model.headers.map(function(h){return '<th scope="col">'+escape(h)+'</th>';}).join('')+'</tr></thead><tbody>'+rows.map(function(row){return '<tr>'+row.map(function(value,index){return '<td'+(model.numeric[index]?' class="number"':'')+'>'+escape(value)+'</td>';}).join('')+'</tr>';}).join('')+'</tbody></table></div></html>';
  }
  var api={parse:parse,decode:decode,htmlTable:htmlTable};
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(!root.document)return;
  root.FluCSVTable=api;
  var document=root.document;
  function init(){
    var studio=document.getElementById('csvStudio');if(!studio)return;
    var byId=function(id){return document.getElementById(id);}, model=null, file=null, page=1, sort=-1, direction=1, version=0, filtered=[];
    function status(message,error){byId('csvStatus').textContent=message;byId('csvStatus').classList.toggle('is-error',!!error);}
    function node(tag,value){var e=document.createElement(tag);if(value!==undefined)e.textContent=value;return e;}
    function render(){
      if(!model)return;
      var query=byId('csvSearch').value.trim().toLocaleLowerCase();
      filtered=model.rows.filter(function(row){return !query||row.some(function(value){return value.toLocaleLowerCase().includes(query);});});
      if(sort>=0)filtered.sort(function(a,b){var x=a[sort].trim(),y=b[sort].trim();if(!x||!y)return x? -1:y?1:0;return direction*(model.numeric[sort]?numericValue(x)-numericValue(y):x.localeCompare(y,'zh-CN',{numeric:true}));});
      var size=Number(byId('csvPageSize').value), pages=Math.max(1,Math.ceil(filtered.length/size));page=Math.max(1,Math.min(page,pages));
      var widths=model.headers.map(function(name,index){var samples=[name].concat(model.rows.slice(0,100).map(function(row){return row[index];}));var length=samples.reduce(function(max,value){return value.split('\n').reduce(function(longest,line){return Math.max(longest,Array.from(line).reduce(function(n,ch){return n+(ch.charCodeAt(0)>255?2:1);},0));},max);},0);return Math.max(116,Math.min(320,length*8+40));});
      var columns=document.createDocumentFragment(),serial=node('col');serial.style.width='54px';columns.appendChild(serial);widths.forEach(function(width){var col=node('col');col.style.width=width+'px';columns.appendChild(col);});byId('csvColumns').replaceChildren(columns);studio.style.setProperty('--csv-table-width',(54+widths.reduce(function(a,b){return a+b;},0))+'px');
      var head=node('tr');head.appendChild(node('th','序号'));
      model.headers.forEach(function(name,index){var th=node('th');th.scope='col';th.setAttribute('aria-sort',index===sort?(direction===1?'ascending':'descending'):'none');var button=node('button',name+(sort===index?(direction===1?' ↑':' ↓'):' ↕'));button.type='button';button.title='按“'+name+'”排序';button.addEventListener('click',function(){direction=sort===index?-direction:1;sort=index;page=1;render();byId('csvHead').querySelectorAll('button')[index].focus({preventScroll:true});});th.appendChild(button);head.appendChild(th);});
      byId('csvHead').replaceChildren(head);
      var fragment=document.createDocumentFragment();
      filtered.slice((page-1)*size,page*size).forEach(function(row,index){var tr=node('tr');tr.appendChild(node('td',String((page-1)*size+index+1)));row.forEach(function(value,column){var td=node('td',value||'—');if(model.numeric[column])td.className='csv-number';if(!value)td.classList.add('csv-empty');tr.appendChild(td);});fragment.appendChild(tr);});
      if(!filtered.length){var empty=node('td','没有匹配的记录，请调整搜索词。');empty.colSpan=model.headers.length+1;var tr=node('tr');tr.appendChild(empty);fragment.appendChild(tr);}
      byId('csvBody').replaceChildren(fragment);byId('csvCount').textContent='显示 '+filtered.length.toLocaleString('zh-CN')+' / '+model.rows.length.toLocaleString('zh-CN')+' 条 · '+model.headers.length+' 列';byId('csvPage').textContent=page+' / '+pages;byId('csvPrev').disabled=page<=1;byId('csvNext').disabled=page>=pages;byId('csvExport').disabled=!filtered.length;
    }
    async function load(selected){
      var request=++version;file=selected;model=null;byId('csvResult').hidden=true;document.dispatchEvent(new CustomEvent('flu:csv-cleared'));
      if(!selected){studio.setAttribute('aria-busy','false');status('请选择 CSV 文件。');return;}
      byId('csvFileName').textContent=selected.name;studio.setAttribute('aria-busy','true');status('正在读取文件、识别列并自动排版…');
      try{
        if(!/\.csv$/i.test(selected.name))throw new Error('请选择 .csv 文件。');
        if(selected.size>2*1024*1024)throw new Error('文件超过 2 MB，请拆分后再导入。');
        var buffer=await selected.arrayBuffer();if(request!==version)return;
        var decoded=decode(buffer,byId('csvEncoding').value), next=parse(decoded.text,byId('csvHeader').checked);
        if(request!==version)return;
        model=next;page=1;sort=-1;direction=1;byId('csvSearch').value='';byId('csvResult').hidden=false;
        byId('csvTableTitle').textContent=selected.name.replace(/\.csv$/i,'');render();
        document.dispatchEvent(new CustomEvent('flu:csv-loaded',{detail:{model:model,title:byId('csvTableTitle').textContent}}));
        status('已生成条形图与表格 · '+decoded.encoding+' · '+({',':'逗号',';':'分号','\t':'制表符'}[model.delimiter])+'分隔'+(model.uneven?' · '+model.uneven+' 行列数不齐，已补空列并保留全部内容':'')+'。文件仅在当前页面处理，刷新后清除。');
      }catch(error){if(request===version)status(error instanceof TypeError?'无法解码文件，请尝试切换为 UTF-8 或 GB18030 编码。':error.message,true);}
      finally{if(request===version)studio.setAttribute('aria-busy','false');}
    }
    byId('csvFile').addEventListener('change',function(){load(this.files[0]);});
    byId('csvEncoding').addEventListener('change',function(){if(file)load(file);});byId('csvHeader').addEventListener('change',function(){if(file)load(file);});
    byId('csvSearch').addEventListener('input',function(){page=1;render();});byId('csvPageSize').addEventListener('change',function(){page=1;render();});
    byId('csvPrev').addEventListener('click',function(){if(page>1){page--;render();}});byId('csvNext').addEventListener('click',function(){page++;render();});
    byId('csvClear').addEventListener('click',function(){version++;file=model=null;document.dispatchEvent(new CustomEvent('flu:csv-cleared'));byId('csvFile').value='';byId('csvFileName').textContent='选择或拖入 CSV，在主页生成条形图';byId('csvResult').hidden=true;studio.setAttribute('aria-busy','false');status('已清除表格，可选择新的文件。');});
    byId('csvDrop').addEventListener('dragover',function(e){e.preventDefault();this.classList.add('is-dragging');});
    byId('csvDrop').addEventListener('dragleave',function(){this.classList.remove('is-dragging');});
    byId('csvDrop').addEventListener('drop',function(e){e.preventDefault();this.classList.remove('is-dragging');if(e.dataTransfer.files.length>1){status('请一次导入一个 CSV 文件。',true);return;}load(e.dataTransfer.files[0]);});
    byId('csvExport').addEventListener('click',function(){if(!model||!filtered.length)return;var title=byId('csvTableTitle').textContent,url=URL.createObjectURL(new Blob([htmlTable(model,filtered,title)],{type:'text/html;charset=utf-8'})),a=node('a');a.href=url;a.download=title.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_')+'-排版表格.html';document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(url);},1000);status('已下载排版表格（全部匹配记录），可独立打开、打印或另存为 PDF。');});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})(typeof window==='object'?window:globalThis);
