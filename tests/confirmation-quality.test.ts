import {describe,it,expect} from "vitest";
import {requireCompleteContractData} from "@/scripts/diag/contract-quality";
import type {PromotionVerdict} from "@/lib/validation/promotionGate";
const passed:PromotionVerdict={promote:true,checks:[],failed:[],evidenceGaps:[],summary:"Passed"};
describe("confirmation data qualification",()=>{
 it("blocks an otherwise passing strategy when the contract archive is incomplete",()=>{
  const result=requireCompleteContractData(passed,false);
  expect(result.promote).toBe(false);expect(result.evidenceGaps).toContain("contract-data");
  expect(result.checks[0].status).toBe("not-measured");expect(passed.promote).toBe(true);
 });
 it("complete data cannot rescue a failed strategy",()=>{
  const failed={...passed,promote:false,failed:["net"]};
  expect(requireCompleteContractData(failed,true).promote).toBe(false);
 });
});
