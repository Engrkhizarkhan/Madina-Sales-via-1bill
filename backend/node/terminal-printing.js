import {pool,transaction} from './db.js';
import {parseJson,fail} from './helpers.js';
import {requireOwner,isOwner} from './account-access.js';
import {audit} from './operations.js';
const key='terminal_print_preferences';
export async function printingSettings(req){
 const [[row]]=await pool.execute('SELECT setting_value FROM settings WHERE setting_key=?',[key]);
 const stored=parseJson(row?.setting_value,{}),slot=Number(req.verifiedTerminal?.match(/^terminal-([1-9][0-9]?):/)?.[1])||null;
 const preference=slot&&stored[String(slot)];
 const own={slot,managed:Boolean(preference?.managed),autoPrint:Boolean(preference?.autoPrint),preview:preference?.preview!==false};
 if(!isOwner(req.user))return {own};
 const [slots]=await pool.query('SELECT slot FROM terminal_slots ORDER BY slot');
 return {own,terminals:slots.map(({slot})=>({slot:Number(slot),managed:false,autoPrint:false,preview:true,...stored[String(slot)]}))};
}
export async function savePrintingSettings(req){
 requireOwner(req.user);
 if(!Array.isArray(req.body?.terminals)||req.body.terminals.length>99)fail('Choose terminal print settings.',422,'validation_error');
 const [slots]=await pool.query('SELECT slot FROM terminal_slots'),allowed=new Set(slots.map(row=>Number(row.slot))),settings={};
 for(const value of req.body.terminals){
  if(!value||!allowed.has(value.slot)||Object.hasOwn(settings,value.slot)||['managed','autoPrint','preview'].some(key=>typeof value[key]!=='boolean'))fail('Invalid terminal print settings.',422,'validation_error');
  settings[value.slot]={managed:value.managed,autoPrint:value.autoPrint,preview:value.preview};
 }
 await transaction(async c=>{
  const [[row]]=await c.execute('SELECT setting_value FROM settings WHERE setting_key=? FOR UPDATE',[key]);
  const before=parseJson(row?.setting_value,{}),after={...before,...settings};
  await c.execute('INSERT INTO settings(setting_key,setting_value,updated_by) VALUES(?,?,?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value),updated_by=VALUES(updated_by)',[key,JSON.stringify(after),req.user.id]);
  await audit('printing.updated','setting',key,before,after,req.user.id,req,c);
 });
 return printingSettings(req);
}
