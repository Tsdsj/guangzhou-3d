// Existing city models remain shared; S1 is an independent prototype only.
import {measureModel} from '../../src/models/model-preflight.js';
import {buildSample as citySample} from '../../src/models/detail-models.js';
import {specieBank} from './c02.js';
import {christChurch} from './c01.js';
import {skybridge} from './skybridge.js';
export function buildSample(id,data){const result=id==='C02'?specieBank(data.buildings.C02):id==='C01'?christChurch(data.buildings.C01):id==='S1'?skybridge(data.skybridge):citySample(id,data);result.geometryMetrics=measureModel(result.group);return result;}
