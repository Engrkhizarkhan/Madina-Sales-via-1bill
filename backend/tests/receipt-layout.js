import test from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_NAME||='receipt_qa';process.env.DB_USER||='qa';process.env.DB_PASSWORD||='unused';
const {validateReceiptLayout}=await import('../node/receipt-config.js');
const {receiptDefaults}=await import('../../shared/receipt-layout.mjs');
test('booking website styling accepts custom size, caption, alignment and normal or bold text',()=>{
 for(const websiteBold of [true,false]){
  const input={...receiptDefaults,websiteLabel:'Booking at',website:'MadinaExpress.pk',websiteSize:20,websiteBold,websiteAlign:'right'};
  assert.deepEqual(validateReceiptLayout(input),input);
 }
 for(const change of [{websiteSize:NaN},{websiteSize:'20'},{websiteBold:'false'},{websiteAlign:'center; color:red'}])assert.throws(()=>validateReceiptLayout({...receiptDefaults,...change}));
});
test('existing saved layouts and older counter clients acquire safe defaults without losing their design',()=>{
 const old={...receiptDefaults,fontSize:13,website:'MadinaExpress.pk'};
 for(const key of ['websiteLabel','websiteSize','websiteBold','websiteAlign'])delete old[key];
 const result=validateReceiptLayout(old);
 assert.equal(result.fontSize,13);assert.equal(result.website,old.website);
 for(const key of ['websiteLabel','websiteSize','websiteBold','websiteAlign'])assert.equal(result[key],receiptDefaults[key]);
 const saved={...receiptDefaults,websiteLabel:'Booking at',websiteSize:18,websiteBold:false,websiteAlign:'left'};
 const retained=validateReceiptLayout(old,saved);
 for(const key of ['websiteLabel','websiteSize','websiteBold','websiteAlign'])assert.equal(retained[key],saved[key]);
});

test('large and small positive sizes are retained; voucher and marketing settings are independent',()=>{
 const input={...receiptDefaults,fontSize:32,websiteSize:60,websiteFont:'Georgia',websiteBox:true,websiteInverted:true,websitePadding:12,websiteBorderWidth:3,voucherFontSize:6.25,voucherPaddingY:0,voucherShowNetCollected:false};
 assert.deepEqual(validateReceiptLayout(input),input);
 assert.equal(validateReceiptLayout({fontSize:13},input).voucherShowNetCollected,false);
 for(const change of [{fontSize:0},{websiteSize:-1},{voucherFontSize:Infinity},{websitePadding:-1},{websiteFont:'url(evil)'},{voucherShowNetCollected:'false'}])assert.throws(()=>validateReceiptLayout({...input,...change}));
});
