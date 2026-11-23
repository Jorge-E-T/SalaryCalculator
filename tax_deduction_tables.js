// Tax Deduction Tables for Weekly Payroll Period (2010)
// Generated from IRS Publication 15

const singleTable = {
  name: "Single Person (including head of household)",
  brackets: [
    {
      "over": 0,
      "but_not_over": 116,
      "tax_amount": 0,
      "tax_rate": 0,
      "excess_over": 0
    },
    {
      "over": 116,
      "but_not_over": 200,
      "tax_amount": 0,
      "tax_rate": 10,
      "excess_over": 116
    },
    {
      "over": 200,
      "but_not_over": 693,
      "tax_amount": 8.4,
      "tax_rate": 15,
      "excess_over": 200
    },
    {
      "over": 693,
      "but_not_over": 1302,
      "tax_amount": 82.35,
      "tax_rate": 25,
      "excess_over": 693
    },
    {
      "over": 1302,
      "but_not_over": 1624,
      "tax_amount": 234.6,
      "tax_rate": 27,
      "excess_over": 1302
    },
    {
      "over": 1624,
      "but_not_over": 1687,
      "tax_amount": 321.54,
      "tax_rate": 30,
      "excess_over": 1624
    },
    {
      "over": 1687,
      "but_not_over": 3344,
      "tax_amount": 340.44,
      "tax_rate": 28,
      "excess_over": 1687
    },
    {
      "over": 3344,
      "but_not_over": 7225,
      "tax_amount": 804.4,
      "tax_rate": 33,
      "excess_over": 3344
    },
    {
      "over": 7225,
      "but_not_over": null,
      "tax_amount": 2085.13,
      "tax_rate": 35,
      "excess_over": 7225
    }
  ]
};

const marriedTable = {
  name: "Married Person",
  brackets: [
    {
      "over": 0,
      "but_not_over": 264,
      "tax_amount": 0,
      "tax_rate": 0,
      "excess_over": 0
    },
    {
      "over": 264,
      "but_not_over": 471,
      "tax_amount": 0,
      "tax_rate": 10,
      "excess_over": 264
    },
    {
      "over": 471,
      "but_not_over": 1457,
      "tax_amount": 20.7,
      "tax_rate": 15,
      "excess_over": 471
    },
    {
      "over": 1457,
      "but_not_over": 1809,
      "tax_amount": 168.6,
      "tax_rate": 25,
      "excess_over": 1457
    },
    {
      "over": 1809,
      "but_not_over": 2386,
      "tax_amount": 256.6,
      "tax_rate": 27,
      "excess_over": 1809
    },
    {
      "over": 2386,
      "but_not_over": 2789,
      "tax_amount": 412.39,
      "tax_rate": 25,
      "excess_over": 2386
    },
    {
      "over": 2789,
      "but_not_over": 4173,
      "tax_amount": 513.14,
      "tax_rate": 28,
      "excess_over": 2789
    },
    {
      "over": 4173,
      "but_not_over": 7335,
      "tax_amount": 900.66,
      "tax_rate": 33,
      "excess_over": 4173
    },
    {
      "over": 7335,
      "but_not_over": null,
      "tax_amount": 1944.12,
      "tax_rate": 35,
      "excess_over": 7335
    }
  ]
};

// Export the tables
export { singleTable, marriedTable };