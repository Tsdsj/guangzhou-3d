// Atomic, bounded-detail lifecycle; never hide fallback while an asset is pending.
export class DetailStream {
  constructor(tiles, hooks, options={}) {
    this.hooks=hooks;this.options={loadDistance:700,releaseDistance:1600,...options};this.pending=new Set();
    this.entries=tiles.map(tile=>({tile,state:'idle',desired:false,active:false,enabled:true,asset:null,generation:0,error:null}));
  }
  update(x,z,height=0) {
    this.pose=[x,z,height];
    for(const e of this.entries){
      const b=e.tile.bounds,dx=Math.max(b[0]-x,0,x-b[2]),dz=Math.max(b[1]-z,0,z-b[3]),distance=Math.hypot(dx,dz,Math.max(0,height-100));
      const wanted=e.enabled&&distance<this.options.loadDistance*(e.active?1.15:1);
      if(wanted&&!e.desired&&e.state==='error'){e.state='idle';e.error=null;}
      e.desired=wanted;
      if(!wanted&&e.active){this.hooks.deactivate(e.tile.id,e.asset);e.active=false;e.state='cached';}
      if(!wanted&&e.state==='loading'){e.generation++;e.abort.abort();e.state='idle';}
      if(distance>this.options.releaseDistance&&e.asset){this.hooks.dispose(e.asset);e.asset=null;e.state='idle';}
      if(wanted&&e.asset&&!e.active){this.hooks.activate(e.tile.id,e.asset);e.active=true;e.state='ready';}
      if(wanted&&e.state==='idle')this.request(e);
    }
    this.hooks.change?.(this.status());
  }
  setEnabled(id,enabled){
    const e=this.entries.find(e=>e.tile.id===id);if(!e)throw new Error('Unknown detail tile');e.enabled=!!enabled;
    if(this.pose)this.update(...this.pose);
  }
  invalidate(id){
    const e=this.entries.find(e=>e.tile.id===id);if(!e)throw new Error('Unknown detail tile');
    e.generation++;e.abort?.abort();
    if(e.asset){if(e.active)this.hooks.deactivate(e.tile.id,e.asset);this.hooks.dispose(e.asset);}
    e.asset=null;e.active=false;e.state='idle';e.error=null;
    if(this.pose)this.update(...this.pose);
  }
  request(e){
    const generation=++e.generation;e.abort=new AbortController();e.state='loading';
    const promise=Promise.resolve(this.hooks.load(e.tile,e.abort.signal)).then(asset=>{
      if(generation!==e.generation||!e.desired){this.hooks.dispose(asset);return;}
      e.asset=asset;this.hooks.activate(e.tile.id,asset);e.active=true;e.state='ready';e.error=null;
    }).catch(error=>{
      if(generation!==e.generation)return;
      if(e.asset){this.hooks.deactivate(e.tile.id,e.asset);this.hooks.dispose(e.asset);e.asset=null;e.active=false;}
      e.state='error';e.error=error.message;
    }).finally(()=>{this.pending.delete(promise);this.hooks.change?.(this.status());});
    this.pending.add(promise);
  }
  status(){return this.entries.map(e=>({id:e.tile.id,state:e.state,active:e.active,desired:e.desired,error:e.error}));}
  settled(){return Promise.all([...this.pending]);}
}
