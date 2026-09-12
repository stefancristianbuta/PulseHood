import { calculateMomentum } from './momentum.js';
import { classifyRisk } from './risk.js';

const momentum = calculateMomentum({
  priceAcceleration: 0,
  volumeAcceleration: 0,
  buyPressure: 0,
  uniqueBuyerScore: 0,
  liquidityScore: 0,
  breakoutScore: 0,
});

const risk = classifyRisk(100);

console.log('PulseHood V1 core initialized', { momentum, risk });
