const { buildUniversalStructured } = require('../lib/ocr-utils');

const sample = `ACME Corporation
123 Main St
Invoice
Invoice No: INV-1001
Date: 2025-10-01
Bill To:
Contoso Ltd
1 Infinite Loop

Item A 2 10.00
Item B 1 20.00

Subtotal 40.00
Tax 4.00
Total 44.00
`;

const out = buildUniversalStructured(sample, { info: {}, numpages: 1 });
console.log(JSON.stringify(out, null, 2));
