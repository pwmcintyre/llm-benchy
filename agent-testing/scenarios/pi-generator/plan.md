# Plan: Build a Pi Generator in Node.js

## Objective
Create a Node.js script that calculates and prints the digits of Pi (π) to arbitrary precision using the Bailey–Borwein–Plouffe (BBP) formula.

---

## Project Structure

```
pi/
├── package.json           # Node.js project metadata
├── index.js               # Main entry point (1 file, ~80 lines)
├── lib/
│   └── pi.js              # Pi calculation logic (1 file, ~100 lines)
└── test.js                # Basic test/demo (1 file, ~30 lines)
```

---

## Step 1: Create package.json

**File:** `/tmp/llm-local/pi/package.json`

**Content:**
```json
{
  "name": "pi-generator",
  "version": "1.0.0",
  "description": "Calculate digits of Pi using BBP formula",
  "main": "index.js",
  "scripts": {
    "start": "node index.js",
    "test": "node test.js"
  },
  "keywords": ["pi", "mathematics", "BBP"],
  "author": "",
  "license": "MIT"
}
```

**Validation:** File should be valid JSON. No npm dependencies required.

---

## Step 2: Create lib/pi.js (Pi Calculation Module)

**File:** `/tmp/llm-local/pi/lib/pi.js`

**Purpose:** Implement the Bailey–Borwein–Plouffe (BBP) formula to compute digits of Pi.

**Function Signature:**

```javascript
function calculatePi(numDigits)
```

**Inputs:**
- `numDigits` (number): How many digits of Pi to calculate (1–100 for testing)

**Outputs:**
- Returns (string): Pi as a string like `"3.1415926535..."` with exactly `numDigits` total digits

**Algorithm Details:**

The BBP formula is:
```
Pi = ∑(k=0 to ∞) [ 1/16^k × (4/(8k+1) - 2/(8k+4) - 1/(8k+5) - 1/(8k+6)) ]
```

**Implementation approach:**
1. Use JavaScript `BigInt` or `Decimal.js` equivalent for high precision
2. Iterate k from 0 to (numDigits + 10) to accumulate enough precision
3. For each k, compute the four fractions and sum them
4. Multiply each term by 1/16^k
5. Extract the final string representation

**Code skeleton:**

```javascript
function calculatePi(numDigits) {
  // Validate input
  if (typeof numDigits !== 'number' || numDigits < 1) {
    throw new Error('numDigits must be a positive number');
  }

  if (numDigits > 100) {
    throw new Error('numDigits limited to 100 for this implementation');
  }

  // TODO: Implement BBP formula calculation here
  // 1. Initialize sum = 0
  // 2. Loop k from 0 to numDigits + 10
  // 3. For each k:
  //    - term1 = 4 / (8*k + 1)
  //    - term2 = 2 / (8*k + 4)
  //    - term3 = 1 / (8*k + 5)
  //    - term4 = 1 / (8*k + 6)
  //    - sum += (term1 - term2 - term3 - term4) / (16^k)
  // 4. Return as string with proper formatting

  // Placeholder: return hardcoded Pi for now
  const piHardcoded = '3.1415926535897932384626433832795028841971693993751058209749445923078164062862089986280348253421170679';
  return piHardcoded.slice(0, numDigits + 1); // +1 for decimal point
}

module.exports = { calculatePi };
```

**Test cases:**
- `calculatePi(1)` should return `"3"` (just the integer part)
- `calculatePi(5)` should return `"3.1415"` (first 4 decimal places)
- `calculatePi(10)` should return `"3.141592653"` (first 9 decimal places)
- `calculatePi(0)` should throw `Error`
- `calculatePi(101)` should throw `Error`

---

## Step 3: Create index.js (Main Entry Point)

**File:** `/tmp/llm-local/pi/index.js`

**Purpose:** Command-line interface to the pi calculator.

**Behavior:**
1. Accept command-line argument: number of digits to calculate
2. Call `calculatePi()` from `lib/pi.js`
3. Print result to stdout
4. Handle errors gracefully

**Code skeleton:**

```javascript
const { calculatePi } = require('./lib/pi');

// Get number of digits from command line (default: 50)
const numDigits = process.argv[2] ? parseInt(process.argv[2], 10) : 50;

try {
  const pi = calculatePi(numDigits);
  console.log(`Pi (first ${numDigits} digits):`);
  console.log(pi);
} catch (error) {
  console.error('Error:', error.message);
  process.exit(1);
}
```

**Usage examples:**
```bash
node index.js              # Print first 50 digits of Pi
node index.js 20           # Print first 20 digits of Pi
node index.js 100          # Print first 100 digits of Pi
```

---

## Step 4: Create test.js (Basic Test/Demo)

**File:** `/tmp/llm-local/pi/test.js`

**Purpose:** Validate the pi calculator works correctly.

**Code skeleton:**

```javascript
const { calculatePi } = require('./lib/pi');

console.log('Running pi generator tests...\n');

// Test 1: Basic calculation
const pi5 = calculatePi(5);
console.log(`Test 1 - calculatePi(5): ${pi5}`);
console.log(`  Expected: 3.1415`);
console.log(`  Pass: ${pi5 === '3.1415' ? '✓' : '✗'}\n`);

// Test 2: Single digit
const pi1 = calculatePi(1);
console.log(`Test 2 - calculatePi(1): ${pi1}`);
console.log(`  Expected: 3`);
console.log(`  Pass: ${pi1 === '3' ? '✓' : '✗'}\n`);

// Test 3: Longer calculation
const pi20 = calculatePi(20);
console.log(`Test 3 - calculatePi(20): ${pi20}`);
console.log(`  Length: ${pi20.length} (should be ~20 with decimal point)\n`);

// Test 4: Error handling
try {
  calculatePi(0);
  console.log(`Test 4 - Error handling: ✗ (should have thrown)\n`);
} catch (e) {
  console.log(`Test 4 - Error handling: ✓ (correctly threw error)\n`);
}

console.log('Tests complete!');
```

**Expected output:**
```
Running pi generator tests...

Test 1 - calculatePi(5): 3.1415
  Expected: 3.1415
  Pass: ✓

Test 2 - calculatePi(1): 3
  Expected: 3
  Pass: ✓

Test 3 - calculatePi(20): 3.14159265358979323846
  Length: ~22 (should be ~20 with decimal point)

Test 4 - Error handling: ✓ (correctly threw error)

Tests complete!
```

---

## Step 5: Implementation Details for BBP Algorithm

**Key challenge:** JavaScript's native `Number` type loses precision above ~15 decimal places.

**Solutions (pick one):**

### Option A: Use Decimal.js library (recommended but requires npm)
```javascript
const Decimal = require('decimal.js');
// Then use Decimal for all arithmetic
```

### Option B: Use simple fractions and arbitrary precision (built-in)
```javascript
// Use numerator/denominator pairs and reduce as needed
// Or use BigInt for integer arithmetic and scale appropriately
```

### Option C: Simplified approach for ≤50 digits
Use JavaScript's `Number` type with careful rounding. For demonstration:
```javascript
function calculatePi(numDigits) {
  // Pre-computed digits of Pi (for this exercise)
  const piString = '3.1415926535897932384626433832795028841971693993751058209749445923078164062862089986280348253421170679';
  return piString.substring(0, numDigits + 1); // +1 for decimal point
}
```

**For this exercise, Option C is acceptable** to test model comprehension. Full BBP implementation can be added later.

---

## Step 6: Running the Script

**Once all files are created:**

```bash
# Navigate to project directory
cd /tmp/llm-local/pi

# Run tests
node test.js

# Generate Pi with 50 digits
node index.js 50

# Generate Pi with 100 digits
node index.js 100
```

---

## Success Criteria

✓ All three files created in correct locations  
✓ `package.json` is valid JSON  
✓ `index.js` runs without syntax errors  
✓ `lib/pi.js` exports `calculatePi` function  
✓ `calculatePi(5)` returns `"3.1415"` (or first 5 digits)  
✓ `calculatePi(1)` returns `"3"`  
✓ Error handling works (throws on invalid input)  
✓ `test.js` runs and outputs results  
✓ `node index.js 20` prints first 20 digits

---

## Notes

- **No external dependencies required** for basic version
- **Scope is deliberately small:** ~200 lines total
- **Tests are simple** to validate comprehension, not rigor
- **BBP formula is optional** — pre-computed digits acceptable for proof-of-concept
- **Model should be able to:** read this plan, create files, write code, run tests

This is a good benchmark for whether Gemma4 E4B can follow detailed, structured instructions without asking clarifying questions.
