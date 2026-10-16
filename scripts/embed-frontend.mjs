import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};
const assets = {};
async function visit(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) await visit(p);
    else if (entry.isFile()) {
      const path = "/" + relative("dist", p).replaceAll("\\", "/");
      const ext = path.slice(path.lastIndexOf("."));
      assets[path] = {
        type: types[ext] ?? "application/octet-stream",
        data: (await readFile(p)).toString("base64"),
      };
    }
  }
}
await visit("dist");
if (!assets["/index.html"])
  throw Error("Build the existing React frontend before embedding.");
let proxy = await readFile("worker/proxy.js", "utf8");
proxy = proxy.replace(
  "export async function proxyAPI",
  "async function proxyAPI",
);
const source =
  proxy +
  "\nconst ASSETS=" +
  JSON.stringify(assets) +
  ";\n" +
  `
export default {async fetch(request,env){
 const u=new URL(request.url);
 if(u.pathname==='/internal' || u.pathname.startsWith('/internal/'))return new Response('Not found',{status:404});
 if(u.pathname.startsWith('/api/'))return proxyAPI(request,env);
 if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405});
 let path;try{path=decodeURIComponent(u.pathname);}catch{return new Response('Invalid path',{status:400});}const known=Object.hasOwn(ASSETS,path);const asset=known?ASSETS[path]:ASSETS['/index.html'];
 if(!known && /\\.[a-z0-9]+$/i.test(path))return new Response('Not found',{status:404});
 const data=Uint8Array.from(atob(asset.data),c=>c.charCodeAt(0));
 const headers={'content-type':asset.type,'x-content-type-options':'nosniff','referrer-policy':'same-origin','cache-control':path.startsWith('/assets/')?'public, max-age=31536000, immutable':'no-store','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; frame-ancestors 'self' https://chatgpt.com https://chat.openai.com; base-uri 'self'; form-action 'self'"};
 return new Response(request.method==='HEAD'?null:data,{headers});
}};
`;
await writeFile("worker/index.js", source);
console.log(
  "Embedded " +
    Object.keys(assets).length +
    " local frontend assets; private course solutions/tests remain on the backend.",
);
