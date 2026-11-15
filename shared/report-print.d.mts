export type ReportNode=string|{tag:string;attrs:Record<string,string>;children:ReportNode[]};
export function validateReportTree(input:unknown):Exclude<ReportNode,string>;
export function reportProtocol(origin:string,id:string,key:string):string;
