export class MemoryStore {
  constructor(){this.records=new Map();this.version=0;}
  async read(key){const r=this.records.get(key);return r?structuredClone(r):null;}
  async write(key,value,version=null){const old=this.records.get(key);if((!old&&version!==null)||(old&&old.version!==version))return null;const result={value:structuredClone(value),version:String(++this.version)};this.records.set(key,result);return structuredClone(result);}
}
export const customer={name:'Cliente de Teste',email:'teste@example.com',document:'52998224725',phone:'11987654321'};
export const testEnv={FIREBOT_API_KEY:'fire_sk_live_test_only',CHECKOUT_SESSION_SECRET:'local-test-session-secret-with-at-least-32-characters',BLOB_STORE_ID:'test-store'};
export function fakeGateway(){return {calls:0,paid:false,async prepare(){},async create(){this.calls++;return {id:'fire_tx_local_test',status:'pending',pix:{emv:'TESTE LOCAL SEM VALOR. NAO E UM PIX REAL.'}};},async status(id){return {id,status:this.paid?'paid':'pending',amount:29700};}};}
