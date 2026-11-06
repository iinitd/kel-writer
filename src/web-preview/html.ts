import { WEB_PREVIEW_DIRECTORY, WEB_PREVIEW_ENTRY, type WebPreviewSnapshot } from "./types";

// All file paths in `snapshot.files` are relative to the project root
// (snapshot.rootPath), not to preview/. The entry html lives at
// `preview/index.html` within that root.
const ENTRY_PATH_WITHIN_ROOT = `${WEB_PREVIEW_DIRECTORY}/${WEB_PREVIEW_ENTRY}`;

function resolveFromFile(value: string, sourcePathWithinRoot: string): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//") || /^[a-z]+:/i.test(trimmed)) return null;
  const clean = trimmed.split(/[?#]/, 1)[0]!.replace(/^\.\//, "");
  if (!clean) return null;
  const base = sourcePathWithinRoot.includes("/")
    ? sourcePathWithinRoot.slice(0, sourcePathWithinRoot.lastIndexOf("/") + 1)
    : "";
  const combined = clean.startsWith("/") ? clean.slice(1) : `${base}${clean}`;
  const stack: string[] = [];
  for (const part of combined.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (stack.length === 0) return null;
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  const resolved = stack.join("/");
  return resolved || null;
}

function cssWithAssets(css: string, sourcePathWithinRoot: string, snapshot: WebPreviewSnapshot): string {
  return css
    .replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (full, _quote, value: string) => {
      const path = resolveFromFile(value.trim(), sourcePathWithinRoot);
      const file = path ? snapshot.files[path] : null;
      return file ? `url("${file.dataUrl}")` : full;
    })
    .replace(/@import\s+(?:url\(\s*)?(["'])([^"']+)\1\s*\)?\s*;/gi, (full, _quote, value: string) => {
      const path = resolveFromFile(value, sourcePathWithinRoot);
      const file = path ? snapshot.files[path] : null;
      return file?.text != null
        ? cssWithAssets(file.text, path!, snapshot)
        : full;
    });
}

function escapeScript(value: string): string {
  return value.replace(/<\/script/gi, "<\\/script");
}

export function buildWebPreviewHtml(snapshot: WebPreviewSnapshot): string {
  let html = snapshot.entryHtml;
  html = html.replace(
    /<link\b([^>]*?)href=["']([^"']+)["']([^>]*)>/gi,
    (full, before: string, href: string, after: string) => {
      if (!/\brel=["']stylesheet["']/i.test(`${before} ${after}`)) return full;
      const path = resolveFromFile(href, ENTRY_PATH_WITHIN_ROOT);
      const file = path ? snapshot.files[path] : null;
      return path && file?.text != null
        ? `<style data-preview-source="${path}">${cssWithAssets(file.text, path, snapshot)}</style>`
        : full;
    },
  );
  html = html.replace(
    /<script\b([^>]*?)src=["']([^"']+)["']([^>]*)><\/script>/gi,
    (full, before: string, src: string, after: string) => {
      const path = resolveFromFile(src, ENTRY_PATH_WITHIN_ROOT);
      const file = path ? snapshot.files[path] : null;
      return file?.text != null ? `<script ${before} ${after} data-preview-source="${path}">${escapeScript(file.text)}</script>` : full;
    },
  );
  html = html.replace(
    /(<(?:img|source|video|audio|iframe)\b[^>]*?\bsrc=["'])([^"']+)(["'][^>]*>)/gi,
    (full, prefix: string, src: string, suffix: string) => {
      const path = resolveFromFile(src, ENTRY_PATH_WITHIN_ROOT);
      const file = path ? snapshot.files[path] : null;
      return file ? `${prefix}${file.dataUrl}${suffix}` : full;
    },
  );

  // Expose files to the runtime fetch bridge keyed BOTH by their
  // root-relative path and by the path relative to preview/ (so a script that
  // literally fetches "./foo.json" from preview/ still works).
  const virtualFiles: Record<string, { dataUrl: string; mime: string }> = {};
  for (const file of Object.values(snapshot.files)) {
    virtualFiles[file.path] = { dataUrl: file.dataUrl, mime: file.mime };
    if (file.path.startsWith(`${WEB_PREVIEW_DIRECTORY}/`)) {
      virtualFiles[file.path.slice(WEB_PREVIEW_DIRECTORY.length + 1)] = {
        dataUrl: file.dataUrl,
        mime: file.mime,
      };
    }
  }
  const bridge = `<script>(function(){
    var files=${JSON.stringify(virtualFiles).replace(/</g, "\u003c")};
    var nativeFetch=window.fetch.bind(window);
    function localPath(input){
      var value=typeof input==='string'?input:(input&&input.url)||'';
      if(!value||value.charAt(0)==='#'||value.slice(0,2)==='//'||/^[a-z]+:/i.test(value))return null;
      try{var pathname=new URL(value,'https://preview.local/').pathname;if(pathname.charAt(0)==='/')pathname=pathname.slice(1);return decodeURIComponent(pathname)}catch(e){return null}
    }
    window.fetch=function(input,init){var path=localPath(input),file=path&&files[path];return file?nativeFetch(file.dataUrl,init):nativeFetch(input,init)};
    var marks=[],activeRange=null;
    function send(type,payload){var msg=JSON.stringify(Object.assign({type:type},payload||{}));if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(msg);else if(window.parent&&window.parent!==window)window.parent.postMessage(msg,'*')}
    (function installEdgeSwipeBridge(){
      if(window.ReactNativeWebView||!('ontouchstart' in window))return;
      var edgeSize=32,side=null,startX=0,startY=0,sent=false,listening=false;
      function stop(){side=null;sent=false;if(listening){document.removeEventListener('touchmove',move);listening=false}}
      function move(event){if(!side||event.touches.length!==1){stop();return}var touch=event.touches[0],dx=touch.clientX-startX,dy=touch.clientY-startY;if(Math.abs(dy)>8&&Math.abs(dy)>Math.abs(dx)*1.2){stop();return}var inward=side==='left'?dx>0:dx<0;if(!inward||Math.abs(dx)<=6||Math.abs(dx)<=Math.abs(dy)*1.2)return;if(event.cancelable)event.preventDefault();if(!sent&&Math.abs(dx)>=40){sent=true;send('edgeSwipe',{edge:side})}}
      function start(event){stop();if(event.touches.length!==1)return;var touch=event.touches[0];side=touch.clientX<=edgeSize?'left':touch.clientX>=window.innerWidth-edgeSize?'right':null;if(!side)return;if(event.cancelable)event.preventDefault();startX=touch.clientX;startY=touch.clientY;document.addEventListener('touchmove',move,{passive:false});listening=true}
      document.documentElement.style.overscrollBehaviorX='none';document.addEventListener('touchstart',start,{passive:false});document.addEventListener('touchend',stop,{passive:true});document.addEventListener('touchcancel',stop,{passive:true});
    })();
    var stateRequests={},stateSequence=0;
    function requestState(type,key,value){return new Promise(function(resolve){var requestId='state-'+Date.now()+'-'+(++stateSequence);var timer=setTimeout(function(){delete stateRequests[requestId];resolve(type==='preview-state-get'?null:false)},3000);stateRequests[requestId]={resolve:resolve,timer:timer,type:type};send(type,{requestId:requestId,key:key,value:value})})}
    window.__kelPreviewStateMessage=function(message){if(!message||!message.requestId)return;var pending=stateRequests[message.requestId];if(!pending)return;clearTimeout(pending.timer);delete stateRequests[message.requestId];pending.resolve(message.command==='preview-state-value'?message.value:!!message.ok)};
    window.kelPreviewState={get:function(key){return requestState('preview-state-get',key)},set:function(key,value){return requestState('preview-state-set',key,value)}};
    function clearMarks(){marks.forEach(function(el){if(el&&el.parentNode)el.parentNode.removeChild(el)});marks=[]}
    function drawMarks(range){clearMarks();var rects=Array.prototype.slice.call(range.getClientRects());rects.forEach(function(rect){if(rect.width<1||rect.height<1)return;var el=document.createElement('span');el.className='kel-preview-selection';el.style.cssText='position:absolute;pointer-events:none;z-index:2147483000;left:'+(rect.left+window.scrollX)+'px;top:'+(rect.top+window.scrollY)+'px;width:'+rect.width+'px;height:'+rect.height+'px;background:rgba(250,204,21,.34);border-radius:3px;box-shadow:0 0 0 1px rgba(234,179,8,.2) inset;';document.body.appendChild(el);marks.push(el)})}
    function selectionChanged(){var selection=window.getSelection&&window.getSelection();var text=selection?String(selection.toString()).trim():'';if(!selection||selection.isCollapsed||!text||selection.rangeCount===0)return;activeRange=selection.getRangeAt(0).cloneRange();drawMarks(activeRange);send('selection',{text:text.slice(0,12000)})}
    var selectionTimer=null;document.addEventListener('selectionchange',function(){if(selectionTimer)clearTimeout(selectionTimer);selectionTimer=setTimeout(selectionChanged,180)});
    var redrawTimer=null;function scheduleRedraw(){if(!activeRange)return;if(redrawTimer)clearTimeout(redrawTimer);redrawTimer=setTimeout(function(){if(activeRange)drawMarks(activeRange)},40)}
    window.addEventListener('scroll',scheduleRedraw,{passive:true});window.addEventListener('resize',scheduleRedraw);
    window.__kelPreviewClearSelection=function(){activeRange=null;clearMarks();var selection=window.getSelection&&window.getSelection();if(selection&&selection.removeAllRanges)selection.removeAllRanges();send('selection',{text:null})};
    window.__kelPreviewSetRunning=function(on){marks.forEach(function(el){el.style.animation=on?'kelPreviewPulse 1.15s ease-in-out infinite':''})};
    window.addEventListener('message',function(event){var message=event.data;if(!message||message.type!=='kel-preview-command')return;if(message.command==='clear-selection')window.__kelPreviewClearSelection();if(message.command==='set-running')window.__kelPreviewSetRunning(!!message.value);if(message.command==='preview-state-value'||message.command==='preview-state-set-result')window.__kelPreviewStateMessage(message)});
    var style=document.createElement('style');style.textContent='@keyframes kelPreviewPulse{0%,100%{opacity:.45}50%{opacity:1}}';document.head.appendChild(style);
    document.addEventListener('click',function(event){var a=event.target&&event.target.closest&&event.target.closest('a[href]');if(!a)return;var href=a.getAttribute('href')||'';if(/^https?:/i.test(href)&&window.ReactNativeWebView){event.preventDefault();window.ReactNativeWebView.postMessage(JSON.stringify({type:'external',url:a.href}))}});
  })();<\/script>`;
  if (/<head\b[^>]*>/i.test(html)) html = html.replace(/<head\b[^>]*>/i, (tag) => `${tag}${bridge}`);
  else html = `${bridge}${html}`;
  return html;
}
