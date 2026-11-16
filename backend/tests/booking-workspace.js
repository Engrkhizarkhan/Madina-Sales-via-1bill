import test from 'node:test';
import assert from 'node:assert/strict';
import {sameBookingCustomer,departureSeatCounts,fareQuantities,allocateFareTotal,paidVoucherBookings} from '../../shared/booking-workspace.mjs';

test('a customer’s existing tickets match by name and mobile only on the same dated departure',()=>{
  const customer={tripRunId:'trip-2026-11-16-run-1',passenger:'Muhammad Ali',phone:'0300 1234567'};
  assert.equal(sameBookingCustomer(customer,{...customer,passenger:'  muhammad   ali ',phone:'+92-300-1234567'}),true);
  for(const change of [{phone:'03001234568'},{passenger:'Muhammad Khan'},{tripRunId:'trip-2026-11-17-run-1'},{phone:''},{passenger:''}])assert.equal(sameBookingCustomer(customer,{...customer,...change}),false);
});
test('departure occupied count includes reservations and bookings but not released seats',()=>{
  assert.deepEqual(departureSeatCounts([
    {bookingStatus:'Confirmed',seats:[1,2]}, {bookingStatus:'Reserved',seats:[3,4]},
    {bookingStatus:'Refunded',seats:[5]}, {bookingStatus:'Cancelled',seats:[6]},
  ]),{booked:2,reserved:2,total:4});
});
test('one fare control can show quantities without averaging different class prices',()=>{
  assert.deepEqual(fareQuantities([5000,4000,5000]),[{fare:5000,count:2},{fare:4000,count:1}]);
  assert.deepEqual(fareQuantities([2250,2250,2250]),[{fare:2250,count:3}]);
});
test('editable total preserves mixed fares until changed and distributes cents exactly',()=>{
  const fares=[5200,4300];
  assert.deepEqual(allocateFareTotal(fares),fares);
  assert.deepEqual(allocateFareTotal(fares,9500),fares);
  assert.deepEqual(allocateFareTotal(fares,9600),[5254.74,4345.26]);
  assert.deepEqual(allocateFareTotal([500,500],1050),[525,525]);
  assert.deepEqual(allocateFareTotal([300,500],900.01),[337.5,562.51]);
  assert.deepEqual(allocateFareTotal([0,0],100.01),[50.01,50]);
  assert.deepEqual(allocateFareTotal(fares,0),[0,0]);
  assert.deepEqual(allocateFareTotal([],100),[]);
  assert.deepEqual(fares,[5200,4300]);
  for(const total of [0,.01,100.01,9500,9999999999.99]){
    const result=allocateFareTotal(Array.from({length:49},(_,i)=>i*100+.01),total);
    assert.equal(result.reduce((sum,fare)=>sum+Math.round(fare*100),0),Math.round(total*100));
    assert.ok(result.every(fare=>fare>=0));
  }
  for(const total of [-1,NaN,Infinity,Number.MAX_SAFE_INTEGER])assert.throws(()=>allocateFareTotal(fares,total));
});
test('both voucher formats use paid passengers; refund history stays available for accounting',()=>{
  const rows=[
    {id:'paid',bookingStatus:'Confirmed',seats:[3],paid:500,refunds:[]},
    {id:'refund',bookingStatus:'Refunded',seats:[1],paid:500,refunds:[{amount:500}]},
    {id:'cancelled',bookingStatus:'Cancelled',seats:[2],paid:500,refunds:[{amount:450}]},
    {id:'reserved',bookingStatus:'Reserved',seats:[4],paid:0,refunds:[]},
    {id:'active-adjustment',bookingStatus:'Confirmed',seats:[5],paid:500,refunds:[{amount:50}]},
  ];
  assert.deepEqual(paidVoucherBookings(rows).map(row=>row.id),['paid','active-adjustment']);
  assert.equal(rows.reduce((sum,row)=>sum+row.paid-row.refunds.reduce((n,r)=>n+r.amount,0),0),1000);
  assert.equal(rows[1].refunds[0].amount,500);
});
