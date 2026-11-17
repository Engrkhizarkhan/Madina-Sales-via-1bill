export type CounterPrintPreferences={autoPrint?:boolean;paper?:'thermal'|'tm-t88iv'|'a4'};
export function onlineCounterUrl(href:string,preferences?:CounterPrintPreferences):string|null;
export function onlineCounterPreferences(href:string):(CounterPrintPreferences&{reports:boolean})|null;
