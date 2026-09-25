export interface CalibrationPoint{confidence:number;correct:boolean}
export interface TemperatureCalibration{schemaVersion:'fs.decision.calibration.v1';temperature:number;examples:number;nllBefore:number;nllAfter:number}
const clamp=(x:number)=>Math.max(1e-7,Math.min(1-1e-7,x));
const logit=(p:number)=>Math.log(clamp(p)/(1-clamp(p)));
const sigmoid=(x:number)=>1/(1+Math.exp(-x));
function nll(xs:CalibrationPoint[],t:number){return xs.reduce((s,x)=>{const p=sigmoid(logit(x.confidence)/t),q=x.correct?p:1-p;return s-Math.log(clamp(q))},0)/Math.max(1,xs.length)}
export function fitTemperatureCalibration(xs:CalibrationPoint[]):TemperatureCalibration{if(xs.length<20)throw new Error('Calibration requires at least 20 held-out examples.');let bestT=1,best=nll(xs,1);for(let t=.25;t<=5;t+=.025){const v=nll(xs,t);if(v<best){best=v;bestT=t}}return{schemaVersion:'fs.decision.calibration.v1',temperature:Number(bestT.toFixed(3)),examples:xs.length,nllBefore:nll(xs,1),nllAfter:best}}
export function calibrateConfidence(confidence:number,c:TemperatureCalibration){return sigmoid(logit(confidence)/c.temperature)}
export function calibrationBins(xs:CalibrationPoint[],bins=10){return Array.from({length:bins},(_,i)=>{const lo=i/bins,hi=(i+1)/bins,rows=xs.filter(x=>x.confidence>=lo&&(i===bins-1?x.confidence<=hi:x.confidence<hi));return{lo,hi,count:rows.length,meanConfidence:rows.length?rows.reduce((s,x)=>s+x.confidence,0)/rows.length:0,accuracy:rows.length?rows.filter(x=>x.correct).length/rows.length:0}})}
