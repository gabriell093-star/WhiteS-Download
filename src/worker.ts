import { ResolverEngine } from "./core/engine.js";
import { ProviderRegistry } from "./core/registry.js";
import { createDefaultProviders } from "./providers/index.js";
import { createBrowserAutomation } from "./browser/automation.js";

interface Env { BROWSER: unknown; }
const registry=new ProviderRegistry();
for(const provider of createDefaultProviders()) registry.register(provider);

export default {
  async fetch(request:Request,env:Env):Promise<Response>{
    const url=new URL(request.url);
    if(request.method==="GET"&&url.pathname==="/") return new Response("WhiteS Download Worker is running.",{headers:{"content-type":"text/plain; charset=utf-8"}});
    if(request.method==="POST"&&url.pathname==="/api/resolve"){
      let body:unknown;
      try{body=await request.json();}catch{return Response.json({ok:false,error:{code:"INVALID_URL",message:"Invalid JSON body.",retryable:false}},{status:400});}
      if(typeof body!=="object"||body===null||typeof (body as {url?:unknown}).url!=="string") return Response.json({ok:false,error:{code:"INVALID_URL",message:"Body must contain a URL string.",retryable:false}},{status:400});
      const engine=new ResolverEngine(registry,{browser:createBrowserAutomation({browser:env.BROWSER})});
      const result=await engine.resolve((body as {url:string}).url);
      return Response.json(result,{status:result.ok?200:result.error.code==="UNSUPPORTED_PROVIDER"?422:400,headers:{"cache-control":"no-store"}});
    }
    return new Response("Not Found",{status:404});
  }
};