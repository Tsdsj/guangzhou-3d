// City models (B1–B3, C01/C02, J1) are shared with the main scene; S1 is an independent prototype only.
import {measureModel} from '../../src/models/model-preflight.js';
import {buildSample as citySample} from '../../src/models/detail-models.js';
import {skybridge} from './skybridge.js';
export function buildSample(id,data){const result=id==='S1'?skybridge(data.skybridge):citySample(id,data);result.geometryMetrics=measureModel(result.group);return result;}
