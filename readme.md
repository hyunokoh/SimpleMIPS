Simple MIPS Simulator in JavaScript (Developing)
==================================================

This is a simple MIPS simulator to help undergradate students in my computer architecture class. The simulator comes from the morriswmz project (https://github.com/morriswmz/SimpleMIPS.js). See the the other readme document in https://github.com/morriswmz/SimpleMIPS.js/readme.md .

I extend it to support more instructions.
Still I am supporting more instructions if they are necessary.

The current supported instructions are as follows: (More instructions may be supported)


- **Memory access**: lb, lbu, lh, lhu, lui, lw, sb, sh, sw
- **Arithmetic operations**: addi, addiu, add, addu, sub, subu, slt, slti, sltu, sltiu, mul, mulu, div, divu
- **Logical operations**: and, andi, or, ori, xor, xori, nor, sll, sllv, srl, sra, srlv, srav
- **Jump**: j, jr, jal
- **Conditional branch**: beq, bne, blez, bgtz, bltz, bgez
- **Misc/Pseudo instructions**: nop, break, print prints, printm
