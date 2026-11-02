export const INTELLIGENT_UI_INSTRUCTIONS = [
  'In the Pods web panel you have a presentation capability named Intelligent UI: when it materially improves understanding, enrich a final answer with one optional interactive view. Keep useful prose before or after it; ordinary questions should stay ordinary text. When the user asks to use Intelligent UI, do not explain its mechanics or claim a tool is missing; answer with the pod-ui view described below instead, unless plain text is clearly the better fit.',
  'Emit the view as one fenced code block tagged pod-ui containing valid JSON. The root shape is {"version":1,"id":"stable-id","title":"Optional title","components":[]}. Supported components: heading {text}; text {text}; stack {children}; card {title?,children}; metric {label,value,detail?}; table {columns:string[],rows:string[][]}; bar-chart {title?,items:[{label,value}]}; callout {tone:"info"|"success"|"warning",text,visibleWhen?}; input {label,key,placeholder?,default?}; select {label,key,options:string[],default?}; slider {label,key,min,max,step?,default?}; checkbox {label,key,default?}; button {label,action:{type:"set",key,value}|{type:"toggle",key}}; link {label,url}. Any component may use visibleWhen:{key,equals} where key is a control key declared in the same view and equals matches the value type of that control: text for input and select, numbers for slider, booleans for checkbox.',
  'Controls and buttons update local presentation state only. They cannot send messages, call tools, edit files, run commands or perform other external actions. Never emit HTML, JavaScript, event handlers, CSS, or arbitrary action names.',
  'Only use facts, values, URLs and sources supported by the conversation or tool results. Never invent data, prices, ratings, locations or citations for a view. Bar-chart values must be non-negative; use a table for signed values. Keep views compact and accessible, with clear labels and units.'
].join('\n')

export const INTELLIGENT_UI_RUNTIME = String.raw`const podUIMemory=new Map();
const POD_UI_JSON_BODY_LIMIT=40000;
function podUISegments(text){
  const source=String(text),lower=source.toLowerCase(),needle='\x60\x60\x60pod-ui',segments=[];let position=0;
  while(true){
    const index=lower.indexOf(needle,position);
    if(index<0)break;
    if(index>position)segments.push({type:'copy',content:source.slice(position,index)});
    const end=source.indexOf('\x60\x60\x60',index+needle.length);
    if(end<0){segments.push({type:'pending',content:source.slice(index+needle.length)});position=source.length;break}
    const body=source.slice(index+needle.length,end).replace(/^\s*\r?\n/,'');
    if(body.length>POD_UI_JSON_BODY_LIMIT)segments.push({type:'copy',content:source.slice(index,end+3)});
    else segments.push({type:'ui',content:body});
    position=end+3;
  }
  if(position<source.length)segments.push({type:'copy',content:source.slice(position)});
  return segments;
}
function renderPodIntelligentAnswer(output){return renderPodLiveOutput(output,false)}
function renderAnswerText(parent,text){
  const prose=[],code=[];let fence='',language='';
  const flushProse=()=>{const content=prose.join('\n').replace(/^\n+|\n+$/g,'');prose.length=0;if(content)parent.append(node('p',content,'answer-copy'))};
  const flushCode=()=>{const block=node('section',undefined,'answer-code'),header=node('div',undefined,'answer-code-header');header.append(node('span',language||'Code','answer-code-language'),copyButton(code.join('\n'),'Copy code','Code copied to clipboard.'));const pre=node('pre',undefined,'answer-code-content');pre.append(node('code',code.join('\n')));block.append(header,pre);parent.append(block);code.length=0};
  for(const line of String(text).split(/\r?\n/)){
    const opening=/^ {0,3}(\x60{3,})(.*)$/.exec(line);
    if(!fence){if(opening){flushProse();fence=opening[1];language=opening[2].trim().split(/\s+/,1)[0]||'Code'}else prose.push(line);continue}
    const closing=/^ {0,3}(\x60{3,})[ \t]*$/.exec(line);
    if(closing&&closing[1].length>=fence.length){flushCode();fence='';language=''}else code.push(line);
  }
  if(fence)flushCode();else flushProse();
}
function renderPodLiveOutput(output,live){
  const source=output===undefined||output===null?'':String(output);
  if(!source.trim())return node('div',undefined,'answer');
  const answer=node('div',undefined,live?'answer streaming':'answer');
  for(const segment of podUISegments(source)){
    if(segment.type==='copy'){renderAnswerText(answer,segment.content);continue}
    if(segment.type==='pending'){
      if(live){const pending=node('div',undefined,'ui-streaming');pending.setAttribute('role','status');pending.append(node('span','Building interactive view','ui-streaming-hint'));answer.append(pending)}
      else renderAnswerText(answer,'\x60\x60\x60pod-ui'+segment.content);
      continue;
    }
    try{answer.append(renderPodIntelligentView(normalizePodIntelligentUI(JSON.parse(segment.content))))}
    catch{renderAnswerText(answer,'\x60\x60\x60pod-ui\n'+segment.content+'\n\x60\x60\x60')}
  }
  return answer;
}
function normalizePodIntelligentUI(value){
  const keyPattern=/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/;
  const fail=()=>{throw new Error('Invalid Pod UI')};
  const text=(value,max=2000)=>typeof value==='string'&&value.length>0&&value.length<=max;
  const scalar=value=>typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value)||typeof value==='string'&&value.length<=1000;
  const validKey=value=>typeof value==='string'&&keyPattern.test(value);
  if(!value||typeof value!=='object'||Array.isArray(value)||value.version!==1||!text(value.id,64)||!keyPattern.test(value.id)||!Array.isArray(value.components)||!value.components.length||value.components.length>20)fail();
  if(value.title!==undefined&&!text(value.title,160))fail();
  let count=0;
  function condition(input){if(input===undefined)return undefined;if(!input||typeof input!=='object'||Array.isArray(input)||!validKey(input.key)||!scalar(input.equals))fail();return{key:input.key,equals:input.equals}}
  function children(input,depth){if(!Array.isArray(input)||!input.length||input.length>20)fail();return input.map(item=>component(item,depth+1))}
  function component(input,depth){
    if(!input||typeof input!=='object'||Array.isArray(input)||depth>5||++count>80||typeof input.type!=='string')fail();
    const result={type:input.type};
    const when=condition(input.visibleWhen);if(when)result.visibleWhen=when;
    switch(input.type){
      case'heading':case'text':if(!text(input.text,input.type==='heading'?160:3000))fail();result.text=input.text;break;
      case'stack':result.children=children(input.children,depth);break;
      case'card':if(input.title!==undefined){if(!text(input.title,160))fail();result.title=input.title}result.children=children(input.children,depth);break;
      case'metric':if(!text(input.label,120)||!text(input.value,120)||input.detail!==undefined&&!text(input.detail,300))fail();result.label=input.label;result.value=input.value;if(input.detail!==undefined)result.detail=input.detail;break;
      case'table':if(!Array.isArray(input.columns)||input.columns.length<1||input.columns.length>8||!input.columns.every(column=>text(column,100))||!Array.isArray(input.rows)||input.rows.length>40||!input.rows.every(row=>Array.isArray(row)&&row.length===input.columns.length&&row.every(cell=>typeof cell==='string'&&cell.length<=600)))fail();result.columns=input.columns;result.rows=input.rows;break;
      case'bar-chart':if(input.title!==undefined&&!text(input.title,160)||!Array.isArray(input.items)||!input.items.length||input.items.length>24||!input.items.every(item=>item&&typeof item==='object'&&text(item.label,100)&&typeof item.value==='number'&&Number.isFinite(item.value)&&item.value>=0&&item.value<=1e12))fail();result.title=input.title;result.items=input.items;break;
      case'callout':if(!['info','success','warning'].includes(input.tone)||!text(input.text,1000))fail();result.tone=input.tone;result.text=input.text;break;
      case'input':if(!text(input.label,160)||!validKey(input.key)||input.placeholder!==undefined&&!text(input.placeholder,120)||input.default!==undefined&&(typeof input.default!=='string'||input.default.length>1000))fail();result.label=input.label;result.key=input.key;if(input.placeholder!==undefined)result.placeholder=input.placeholder;if(input.default!==undefined)result.default=input.default;break;
      case'select':if(!text(input.label,160)||!validKey(input.key)||!Array.isArray(input.options)||input.options.length<1||input.options.length>20||!input.options.every(option=>text(option,100))||input.default!==undefined&&!input.options.includes(input.default))fail();result.label=input.label;result.key=input.key;result.options=input.options;if(input.default!==undefined)result.default=input.default;break;
      case'slider':if(!text(input.label,160)||!validKey(input.key)||typeof input.min!=='number'||!Number.isFinite(input.min)||typeof input.max!=='number'||!Number.isFinite(input.max)||input.min>=input.max||Math.abs(input.min)>1e9||Math.abs(input.max)>1e9||input.step!==undefined&&(typeof input.step!=='number'||!Number.isFinite(input.step)||input.step<=0||input.step>input.max-input.min)||input.default!==undefined&&(typeof input.default!=='number'||!Number.isFinite(input.default)||input.default<input.min||input.default>input.max))fail();result.label=input.label;result.key=input.key;result.min=input.min;result.max=input.max;if(input.step!==undefined)result.step=input.step;if(input.default!==undefined)result.default=input.default;break;
      case'checkbox':if(!text(input.label,160)||!validKey(input.key)||input.default!==undefined&&typeof input.default!=='boolean')fail();result.label=input.label;result.key=input.key;result.default=input.default===true;break;
      case'button':if(!text(input.label,100)||!input.action||typeof input.action!=='object'||!validKey(input.action.key))fail();if(input.action.type==='toggle')result.action={type:'toggle',key:input.action.key};else if(input.action.type==='set'&&scalar(input.action.value))result.action={type:'set',key:input.action.key,value:input.action.value};else fail();result.label=input.label;break;
      case'link':if(!text(input.label,160)||!text(input.url,2048))fail();const url=new URL(input.url);if(url.protocol!=='https:'||url.username||url.password)fail();result.label=input.label;result.url=url.href;break;
      default:fail();
    }
    return result;
  }
  const components=value.components.map(item=>component(item,1));
  return{ id:value.id,title:value.title,components };
}
function renderPodIntelligentView(spec){
  const root=node('section',undefined,'intelligent-ui');root.dataset.uiId=spec.id;root.setAttribute('aria-label',spec.title||'Interactive response');
  if(spec.title)root.append(node('h2',spec.title,'intelligent-ui-title'));
  const body=node('div',undefined,'intelligent-ui-body'),state=Object.create(null),conditions=[];root.append(body);
  const remembered=podUIMemory.get(spec.id);
  function ensure(key,value){if(!Object.prototype.hasOwnProperty.call(state,key))state[key]=remembered&&Object.prototype.hasOwnProperty.call(remembered,key)?remembered[key]:value}
  function ruleMatches(rule){if(!Object.prototype.hasOwnProperty.call(state,rule.key))return false;const have=state[rule.key],want=rule.equals;if(Object.is(have,want))return true;if(typeof have==='number'){const numeric=Number(want);return Number.isFinite(numeric)&&Object.is(numeric,have)}if(typeof want==='number'){const numeric=Number(have);return Number.isFinite(numeric)&&Object.is(numeric,want)}return false}
  function render(item){
    let element;
    switch(item.type){
      case'heading':element=node('h3',item.text,'ui-heading');break;
      case'text':element=node('p',item.text,'ui-text');break;
      case'stack':element=node('div',undefined,'ui-stack');item.children.forEach(child=>element.append(render(child)));break;
      case'card':element=node('section',undefined,'ui-card');if(item.title)element.append(node('h3',item.title,'ui-card-title'));item.children.forEach(child=>element.append(render(child)));break;
      case'metric':element=node('div',undefined,'ui-metric');element.append(node('span',item.label,'ui-metric-label'),node('strong',item.value,'ui-metric-value'));if(item.detail)element.append(node('span',item.detail,'ui-metric-detail'));break;
      case'table':{element=node('div',undefined,'ui-table-wrap');const table=document.createElement('table'),head=document.createElement('thead'),headRow=document.createElement('tr');item.columns.forEach(column=>{const th=node('th',column);th.scope='col';headRow.append(th)});head.append(headRow);table.append(head);const rows=document.createElement('tbody');item.rows.forEach(row=>{const tr=document.createElement('tr');row.forEach(cell=>tr.append(node('td',cell)));rows.append(tr)});table.append(rows);element.append(table);break}
      case'bar-chart':{element=node('figure',undefined,'ui-chart');if(item.title)element.append(node('h3',item.title,'ui-card-title'));const list=node('div',undefined,'ui-chart-list');const max=Math.max(1,...item.items.map(point=>point.value));item.items.forEach(point=>{const row=node('div',undefined,'ui-chart-row'),label=node('span',point.label,'ui-chart-label'),progress=document.createElement('progress'),number=node('span',String(point.value),'ui-chart-value');progress.max=max;progress.value=point.value;progress.setAttribute('aria-label',point.label+': '+point.value);number.textContent=String(Number(point.value.toPrecision(6)));row.append(label,progress,number);list.append(row)});element.append(list);break}
      case'callout':element=node('p',item.text,'ui-callout');element.dataset.tone=item.tone;break;
      case'input':{ensure(item.key,item.default||'');element=node('label',item.label,'ui-field');const control=document.createElement('input');control.type='text';control.maxLength=1000;control.placeholder=item.placeholder||'';control.dataset.uiKey=item.key;control.value=String(state[item.key]);control.addEventListener('input',()=>{state[item.key]=control.value;sync(control)});element.append(control);break}
      case'select':{ensure(item.key,item.default===undefined?item.options[0]:item.default);element=node('label',item.label,'ui-field');const control=document.createElement('select');control.dataset.uiKey=item.key;item.options.forEach(value=>{const option=node('option',value);option.value=value;control.append(option)});control.value=String(state[item.key]);control.addEventListener('change',()=>{state[item.key]=control.value;sync(control)});element.append(control);break}
      case'slider':{ensure(item.key,item.default===undefined?item.min:item.default);element=node('label',item.label,'ui-field ui-slider');const row=node('span',undefined,'ui-slider-row'),control=document.createElement('input'),output=document.createElement('output');control.type='range';control.min=String(item.min);control.max=String(item.max);control.step=String(item.step||1);control.dataset.uiKey=item.key;control.value=String(state[item.key]);output.dataset.uiOutput=item.key;row.append(control,output);element.append(row);control.addEventListener('input',()=>{state[item.key]=Number(control.value);sync(control)});break}
      case'checkbox':{ensure(item.key,item.default===true);element=node('label',undefined,'ui-checkbox');const control=document.createElement('input');control.type='checkbox';control.dataset.uiKey=item.key;control.checked=state[item.key]===true;element.append(control,node('span',item.label));control.addEventListener('change',()=>{state[item.key]=control.checked;sync(control)});break}
      case'button':element=node('button',item.label,'ui-action');element.type='button';element.addEventListener('click',()=>{if(item.action.type==='toggle')state[item.action.key]=!Boolean(state[item.action.key]);else state[item.action.key]=item.action.value;sync()});break;
      case'link':element=node('a',item.label,'ui-link');element.href=item.url;element.target='_blank';element.rel='noopener noreferrer';break;
    }
    if(item.visibleWhen){const rule={element,key:item.visibleWhen.key,equals:item.visibleWhen.equals};conditions.push(rule);element.hidden=!ruleMatches(rule)}
    return element;
  }
  function sync(source){root.querySelectorAll('[data-ui-key]').forEach(control=>{if(control===source)return;const value=state[control.dataset.uiKey];if(control.type==='checkbox')control.checked=value===true;else control.value=String(value===undefined?'':value)});root.querySelectorAll('[data-ui-output]').forEach(output=>{output.value=String(state[output.dataset.uiOutput]??'')});conditions.forEach(rule=>{rule.element.hidden=!ruleMatches(rule)})}
  spec.components.forEach(item=>body.append(render(item)));podUIMemory.set(spec.id,state);if(podUIMemory.size>50)podUIMemory.delete(podUIMemory.keys().next().value);sync();return root;
}`
