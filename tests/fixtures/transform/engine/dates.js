// Scripts turn the dates counties print into ISO dates with `new Date(text)`.
const fs = require('fs');
const path = require('path');

const texts = [
  '1/5/2020', '01/05/2020', '12/31/1999', '6/7/1955', '1/5/20', '1/5/99', '1/5/49', '1/5/50', '13/31/1999', '2/30/2020', '2/29/2019', '0/5/2020', '1/0/2020', '1/32/2020',
  '1/5/2020 12:00:00 AM', '1/5/2020 3:45 PM', '1/5/2020 3:45:10 PM', '1/5/2020 00:00', '1/5/2020 15:45', '1/5/2020 12:30 AM', '1/5/2020 12:30 PM', '1/5/2020 3:45PM', '1/5/2020 13:45 PM',
  '01-05-2020', '1-5-2020', '2020/01/05', '2020/1/5', '1.5.2020', '05.01.2020', '20200105',
  '2020-01-05', '2020-1-5', '2020-01', '2020', '2020-01-05T00:00:00', '2020-01-05T10:30:00Z', '2020-01-05 10:30:00', '2020-01-05T10:30', '2020-01-05T10:30:00.123', '2020-01-05T10:30:00.123456Z',
  '2020-01-05T00:00:00.000-05:00', '2020-01-05T00:00:00+0530', '2020-01-05T24:00:00', '2020-01-05T25:00:00', '2020-01-05 10:30:00 AM', '2020-01-05T10:30:00 Z',
  '0000-00-00', '2020-00-10', '2020-01-00', '2020-13-01', '2020-01-32', '2020-02-30', '2020-02-31', '2021-02-29', '1900-01-01', '0001-01-01', '9999-12-31', '+002020-01-05', '-000001-01-01',
  'Jan 5, 2020', 'January 5, 2020', 'Jan. 5, 2020', 'Jan 5 2020', 'jan 5 2020', 'JANUARY 5, 2020', '5 Jan 2020', '5 January 2020', '5-Jan-2020', '05-JAN-20', '05-Jan-2020', 'Jan-05-2020',
  'Jan 2020', 'January 2020', 'Sept 5, 2020', 'Sep 5, 2020', 'September 5, 2020', 'January 5th, 2020', 'Sunday, January 5, 2020', 'Sun Jan 05 2020', 'Sun, 05 Jan 2020 00:00:00 GMT',
  'Sun Jan 05 2020 10:30:00 GMT+0000 (Coordinated Universal Time)', 'Sun Jan 05 2020 10:30:00 GMT-0500 (Eastern Standard Time)', 'Jan 5 2020 10:00 AM', 'Jan 5, 2020 10:00:00', 'Jan 5, 2020, 10:00 PM',
  'Dec 31, 1899', 'Feb 30, 2020', 'Jan 5, 20', 'Mar 3 99', 'May 2020', 'June 1 2020', 'Jul 4, 1976 EST', 'Jul 4, 1976 EDT', 'Jul 4, 1976 UTC', 'Jul 4, 1976 GMT+2', '4 Jul 1976 12:00 PST',
  '', ' ', 'N/A', 'today', 'null', 'undefined', '0', '1', '12', '123', '1234', '12345', '2020-W01', 'Q1 2020', '2020 Jan 5', '5/2020', '2020-01-05x', 'x2020-01-05', ' 2020-01-05 ', '\t1/5/2020\n',
  '1/5/2020 - 1/6/2020', '1/5/2020 (recorded)', 'Recorded 1/5/2020', '01/05/2020 Book 12 Page 34', '12:30', '12:30 PM', 'T10:30:00',
];
const iso = (date) => (Number.isNaN(date.getTime()) ? 'Invalid Date' : date.toISOString());
const fixed = new Date(2020, 0, 5, 9, 7, 3, 45);
const checks = {
  parsed: Object.fromEntries(texts.map((text) => [JSON.stringify(text), iso(new Date(text))])),
  parse_function: [Date.parse('1/5/2020'), Date.parse('2020-01-05'), Date.parse('nope'), Date.parse('0000-00-00')].map(String),
  from_parts: [new Date(2020, 0, 5), new Date(2020, 0), new Date(99, 0, 5), new Date(2020, 12, 1), new Date(2020, 0, 0), new Date(2020, 1, 30), new Date('2020', '0', '5')].map(iso),
  from_number: [new Date(0), new Date(1578182400000), new Date(NaN), new Date(8.64e15), new Date(8.64e15 + 1), new Date(-1)].map(iso),
  from_other: [new Date(null), new Date(undefined), new Date(true), new Date('1578182400000'), new Date(new Date(0)), new Date([2020, 1, 5]), new Date({})].map(iso),
  text: [String(new Date(NaN)), fixed.toDateString(), fixed.toUTCString(), fixed.toTimeString().slice(0, 17), JSON.stringify({ at: fixed }), String(fixed).slice(0, 33)],
  getters: [fixed.getFullYear(), fixed.getMonth(), fixed.getDate(), fixed.getDay(), fixed.getHours(), fixed.getMinutes(), fixed.getSeconds(), fixed.getMilliseconds(), fixed.getTimezoneOffset(), fixed.getTime()],
  arithmetic: [new Date(2020, 0, 31).setMonth(1), new Date('2020-03-08T12:00:00Z') - new Date('2020-03-07T12:00:00Z'), Math.round((new Date('1/5/2021') - new Date('1/5/2020')) / 864e5)],
};

fs.mkdirSync('data', { recursive: true });
fs.writeFileSync(path.join('data', 'probe.json'), JSON.stringify({ checks }, null, 2));
