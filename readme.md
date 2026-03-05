Simple MIPS Simulator in JavaScript (Developing)
==================================================

This is a simple MIPS simulator to help undergradate students in my computer architecture class. The simulator comes from the morriswmz project (https://github.com/morriswmz/SimpleMIPS.js). See the the other readme document in https://github.com/morriswmz/SimpleMIPS.js/readme.md .

I extend it to support more instructions.
Still I am supporting more instructions if they are necessary.

The current supported instructions are as follows: (More instructions may be supported)


- **Memory access**: lb, lbu, lh, lhu, lui, lw, sb, sh, sw
- **Arithmetic operations**: addi, addiu, add, addu, sub, subu, slt, slti, sltu, sltiu, mult, multu, div, divu
- **Logical operations**: and, andi, or, ori, xor, xori, nor, sll, sllv, srl, sra, srlv, srav
- **HI/LO register access**: mfhi, mflo, mthi, mtlo
- **Jump**: j, jr, jal
- **Conditional branch**: beq, bne, blez, bgtz, bltz, bgez
- **Misc/Pseudo instructions**: nop, break, print, prints, printm, la, li, pushr, popr

---

## Recent Changes

### Multiply/Divide: Standard MIPS HI/LO Behavior

The multiply and divide instructions have been updated to follow the standard MIPS specification. Results are now stored in the special `HI` and `LO` registers instead of a general-purpose register, and four new instructions are added to access them.

**Removed (non-standard):**
- `mul rd, rs, rt` — stored only the lower 32-bit result in `rd`
- `mulu rd, rs, rt` — unsigned variant, same issue

**Replaced with standard MIPS:**

| Instruction | Operation |
|-------------|-----------|
| `mult rs, rt` | Signed 32×32 multiply → 64-bit result in HI:LO |
| `multu rs, rt` | Unsigned 32×32 multiply → 64-bit result in HI:LO |
| `div rs, rt` | Signed divide: LO = rs/rt (quotient), HI = rs%rt (remainder) |
| `divu rs, rt` | Unsigned divide: LO = rs/rt (quotient), HI = rs%rt (remainder) |

**New HI/LO access instructions:**

| Instruction | Operation |
|-------------|-----------|
| `mfhi rd` | rd = HI (move from HI) |
| `mflo rd` | rd = LO (move from LO) |
| `mthi rs` | HI = rs (move to HI) |
| `mtlo rs` | LO = rs (move to LO) |

Both functional and cycle-accurate pipeline simulation modes are supported. The pipeline mode includes data hazard detection and forwarding for all HI/LO instructions.

### Usage Example

```mips
# Signed multiplication: 10 * 3 = 30
ori  $t0, $zero, 10
ori  $t1, $zero, 3
mult $t0, $t1          # HI:LO = 10 * 3 = 30
mflo $t2               # $t2 = 30 (lower 32 bits)
mfhi $t3               # $t3 = 0  (upper 32 bits)

# Signed division: 10 / 3
div  $t0, $t1          # LO = 3 (quotient), HI = 1 (remainder)
mflo $t4               # $t4 = 3
mfhi $t5               # $t5 = 1

# Writing to HI/LO directly
mthi $t0               # HI = $t0
mtlo $t1               # LO = $t1
mfhi $t2               # $t2 = HI
mflo $t3               # $t3 = LO
```
