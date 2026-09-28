import {
  buildHourlyPredictionRequest,
  buildV3OptimizationPayloads,
  buildV3Payload,
  diagnoseV3Payload,
  getDisplayedOutdoorTemperatureForClimate,
} from '../src/api.js';

let input = '';
for await (const chunk of process.stdin) input += chunk;

const { design, materials, climate, weatherProfile } = JSON.parse(input);
const climates = { [design.location]: climate };
const summaryPayload = buildV3Payload(
  design,
  materials,
  climates,
  getDisplayedOutdoorTemperatureForClimate(climate),
);
const hourlyPayload = buildHourlyPredictionRequest(design, materials, climates, weatherProfile);
const candidates = buildV3OptimizationPayloads(design, materials, climates).map((candidate) => ({
  ...candidate,
  diagnostics: diagnoseV3Payload(candidate.payload),
}));

process.stdout.write(JSON.stringify({ summaryPayload, hourlyPayload, candidates }));
