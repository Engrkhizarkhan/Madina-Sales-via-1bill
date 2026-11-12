import { createContext, useContext } from 'react';
export type OperatingPolicies={staffCanEditFare:boolean;staffCanDiscount:boolean;staffMaxDiscountPercent:number;staffMaxCollection:number;staffCanRefund:boolean;staffMaxRefundPercent:number;staffMaxRefundAmount:number};
export const StaffPolicyContext=createContext<OperatingPolicies|null>(null);
export const useStaffPolicy=()=>useContext(StaffPolicyContext);
