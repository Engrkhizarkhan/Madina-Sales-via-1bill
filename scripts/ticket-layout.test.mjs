import test from 'node:test';
import assert from 'node:assert/strict';
import { coachRows, sleeperRows, seatLabel, seatList } from '../src/seat-layout.ts';
import { ticketPresentation, ticketDate, ticketTime } from '../src/ticket-format.ts';

test('49-seat paper plan matches the front pairs and five-seat rear bench', () => {
  const rows = coachRows(49);
  assert.deepEqual(rows[0], {left: [4, 3], center: null, right: [2, 1]});
  assert.deepEqual(rows[10], {left: [44, 43], center: null, right: [42, 41]});
  assert.deepEqual(rows[11], {left: [49, 48], center: 47, right: [46, 45]});
});
test('41-seat screen plan preserves the four front single seats and final left seat', () => {
  const rows = coachRows(41);
  assert.deepEqual(rows[0], {left: [3, null], center: null, right: [2, 1]});
  assert.deepEqual(rows[3], {left: [12, null], center: null, right: [11, 10]});
  assert.deepEqual(rows[4], {left: [16, 15], center: null, right: [14, 13]});
  assert.deepEqual(rows.at(-1), {left: [41, null], center: null, right: [null, null]});
});
test('every configured coach capacity retains every stored seat exactly once', () => {
  for (let capacity = 1; capacity <= 100; capacity++) {
    const seats = coachRows(capacity).flatMap(r => [...r.left, r.center, ...r.right]).filter(s => s !== null);
    assert.deepEqual(seats.sort((a,b) => a-b), Array.from({length:capacity},(_,i)=>i+1));
  }
});
test('sleeper room positions and A/B labels match the 35-berth plan', () => {
  const rows = sleeperRows(35);
  assert.deepEqual(rows[0], [
    {label:'A-1',seats:[1]}, {label:'A-2-3',seats:[2,3]},
    {label:'B-1',seats:[16]}, {label:'B-2-3',seats:[17,18]},
  ]);
  assert.deepEqual(rows[4].map(r=>r.label), ['A-13','A-14-15','B-13','B-14-15']);
  assert.deepEqual(rows.flatMap(r=>r.flatMap(c=>c.seats)).sort((a,b)=>a-b),Array.from({length:30},(_,i)=>i+1));
  assert.equal(seatList([1,15,16,30,31,35],'Sleeper Bus'), 'A-1, A-15, B-1, B-15, 31, 35');
  assert.equal(seatLabel(16,'Executive'),'16');
  assert.equal(seatList([49,48,47],'Standard Plus'),'49, 48, 47');
});
test('sleeper groups never introduce a nonexistent stored seat', () => {
  for(let capacity=1;capacity<=35;capacity++) {
    const seats=sleeperRows(capacity).flatMap(r=>r.flatMap(c=>c.seats));
    assert.deepEqual(seats.sort((a,b)=>a-b),Array.from({length:Math.min(capacity,30)},(_,i)=>i+1));
  }
});
test('only confirmed and settled tickets get conductor tokens', () => {
  for(const bookingStatus of ['Reserved','Cancelled','Refunded']) {
    for(const paymentStatus of ['Unpaid','Paid','Partially refunded','Refunded']) {
      assert.equal(ticketPresentation({bookingStatus,paymentStatus,balance:0}).canBoard,false);
    }
  }
  for(const paymentStatus of ['Paid','Partially refunded']) {
    assert.equal(ticketPresentation({bookingStatus:'Confirmed',paymentStatus,balance:0}).canBoard,true);
    assert.equal(ticketPresentation({bookingStatus:'Confirmed',paymentStatus,balance:1}).canBoard,false);
  }
  assert.equal(ticketPresentation({bookingStatus:'Confirmed',paymentStatus:'Unpaid',balance:0}).canBoard,false);
  assert.equal(ticketPresentation({bookingStatus:'Confirmed',paymentStatus:'Refunded',balance:0}).canBoard,false);
});
test('ticket date and print time remain in Pakistan time', () => {
  assert.equal(ticketDate('2026-10-21'),'21-Oct-26');
  assert.equal(ticketTime(new Date('2026-10-20T20:05:00Z')),'01:05');
});
