import test from 'node:test';
import assert from 'node:assert/strict';
process.env.DB_NAME||='receipt_qa';process.env.DB_USER||='qa';process.env.DB_PASSWORD||='unused';
const {validateReceiptLayout}=await import('../node/receipt-config.js');
const {receiptDefaults,receiptLayoutWithDefaults,boardingStyle,isBoardingField}=await import('../../shared/receipt-layout.mjs');
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

test('legacy boarding passes inherit their existing appearance and are frozen before a receipt-only edit',()=>{
 const legacy={businessName:'Existing company',font:'Georgia',fontSize:14,seatSize:30,urduSize:12,paddingX:5,paddingY:4,lineHeight:1.6,tokenTitle:'Existing token',tokenNote:'پرانا نوٹ'};
 const migrated=receiptLayoutWithDefaults(legacy);
 assert.equal(migrated.boardingBusinessName,'Existing company');assert.equal(migrated.boardingFont,'Georgia');assert.equal(migrated.boardingFontSize,14);assert.equal(migrated.boardingSeatSize,30);assert.equal(migrated.boardingPaddingX,5);
 const changed=validateReceiptLayout({businessName:'New receipt name',font:'Tahoma',fontSize:22},legacy);
 assert.equal(changed.boardingBusinessName,'Existing company');assert.equal(changed.boardingFont,'Georgia');assert.equal(changed.boardingFontSize,14);assert.equal(changed.tokenTitle,legacy.tokenTitle);
});
test('boarding text, sizes, spacing and visibility save independently of the other two designs',()=>{
 const original={...receiptDefaults,fontSize:17,voucherFontSize:8,website:'Custom.pk'};
 const result=validateReceiptLayout({boardingFont:'Georgia',boardingFontSize:16,boardingHeadingSize:28,boardingSeatSize:40,boardingLineHeight:1.75,boardingUrduLineHeight:2.5,boardingPaddingX:0,boardingRowPadding:0,boardingBorderWidth:0,boardingHeaderLayout:'stacked',boardingHeaderAlign:'center',boardingShowPaid:false,tokenTitle:'CONDUCTOR COPY',tokenNote:'نیا نوٹ'},original);
 assert.equal(result.fontSize,17);assert.equal(result.voucherFontSize,8);assert.equal(result.website,'Custom.pk');assert.equal(result.tokenTitle,'CONDUCTOR COPY');
 const style=boardingStyle(result);assert.equal(style['--receipt-font'],'Georgia');assert.equal(style['--receipt-font-size'],'16px');assert.equal(style['--receipt-line-height'],'1.75');assert.equal(style['--boarding-header-layout'],'block');assert.equal(style['--receipt-padding-x'],'0mm');assert.equal(style['--boarding-border-width'],'0px');
 assert.equal(validateReceiptLayout({fontSize:25,voucherHeadingSize:18},result).boardingFontSize,16);
 assert.equal(isBoardingField('tokenTitle'),true);assert.equal(isBoardingField('tokenNote'),true);assert.equal(isBoardingField('boardingFontSize'),true);assert.equal(isBoardingField('businessName'),false);assert.equal(isBoardingField('voucherFont'),false);
});
test('boarding design rejects executable font/style values, invalid flags and non-finite sizes',()=>{
 for(const change of [{boardingFont:'url(evil)'},{boardingFontSize:0},{boardingLineHeight:Infinity},{boardingRowPadding:-1},{boardingHeaderAlign:'left; color:red'},{boardingHeaderLayout:'grid;display:none'},{boardingShowPaid:'false'},{boardingNoteBold:1},{boardingBusinessName:'bad\u0000text'}])assert.throws(()=>validateReceiptLayout(change),error=>error.status===422);
 assert.equal(validateReceiptLayout({boardingFontSize:200,boardingPaddingY:0}).boardingFontSize,200);
});
