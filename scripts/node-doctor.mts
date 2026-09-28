import {runNodeDoctor} from '../src/node-doctor.js';
const report=await runNodeDoctor({shell:process.env.FS_REMOTE_DOCTOR_SHELL});console.log(JSON.stringify(report,null,2));if(!report.ok)process.exitCode=1;
