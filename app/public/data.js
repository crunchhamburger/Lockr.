// The fixed parts of the app: places, meters, buildings, floor sketches and courses.
// Everything that counts or ranks (scores, who is there, posts) comes from the server.

// [id, name, where, code, kind, tags, building, note]
export const SPOTS = [
  ['mansueto', 'Mansueto Grand Reading Room', 'Mansueto Library', 'MAN·1', 'silent', ['Silent', 'Glass dome', 'Outlets'], 'man', 'Under the dome. Drop a pen and forty people look up.'],
  ['harper', 'Harper Reading Room', 'Harper Memorial Library, 3rd floor', 'HAR·3', 'silent', ['Gothic', 'Silent', 'Photogenic'], 'har', 'Cathedral ceilings. You will take a photo before you open your laptop.'],
  ['reg5', 'Reg 5th Floor', 'Regenstein Library, 5th floor', 'REG·5', 'silent', ['Silent', 'Empty', 'Stacks'], 'reg', 'Where people go to disappear until the problem set is done.'],
  ['crerar', 'Crerar Lower Level', 'Crerar Library', 'CRE·LL', 'quiet', ['Quiet', 'STEM', 'Whiteboards'], 'cre', 'Fluorescent, windowless, extremely effective.'],
  ['law', 'D\'Angelo Law Library', 'Law School, south of the Midway', 'LAW·2', 'silent', ['Views', 'Silent', 'Far'], 'law', 'Worth the walk across the Midway. Check access during finals.'],
  ['reg2', 'Reg 2nd Floor Reading Room', 'Regenstein Library, 2nd floor', 'REG·2', 'quiet', ['Quiet', 'Big tables', 'Outlets'], 'reg', 'The default. Nobody picks it, everybody ends up here.'],
  ['eckhart', 'Eckhart Library', 'Eckhart Hall', 'ECK·2', 'quiet', ['Tiny', 'Math', 'Chalkboards'], 'eck', 'Small room, big proofs. Seats go fast before midterms.'],
  ['saieh', 'Saieh Hall', 'Saieh Hall for Economics', 'SAI·1', 'quiet', ['Bright', 'Econ', 'Nice chairs'], 'sai', 'Looks like a consulting firm lobby, which is the point.'],
  ['alevel', 'Reg A-Level', 'Regenstein Library, A-Level', 'REG·A', 'social', ['Late night', 'Group work', 'Loud'], 'reg', 'Open late. Half study hall, half social experiment.'],
  ['logan', 'Logan Center Upper Floors', 'Logan Center for the Arts', 'LOG·9', 'quiet', ['Views', 'Arts', 'Hidden'], 'log', 'Skyline views and almost nobody knows about it.'],
  ['booth', 'Booth Winter Garden', 'Harper Center', 'BTH·1', 'social', ['Glass atrium', 'Bright', 'MBA energy'], 'bth', 'Sit here in a quarter-zip and nobody will ask questions.'],
  ['grounds', 'Grounds of Being', 'Swift Hall basement', 'SWI·B', 'cafe', ['Coffee', 'Cheap', 'Cash vibes'], 'swi', 'Divinity School coffee shop. Good for reading, bad for calls.'],
  ['exlibris', 'Ex Libris Café', 'Regenstein Library, 1st floor', 'REG·1', 'cafe', ['Coffee', 'Group work', 'Loud'], 'reg', 'You came to study and stayed to talk for two hours.'],
  ['hallowed', 'Hallowed Grounds', 'Reynolds Club, 2nd floor', 'REY·2', 'cafe', ['Coffee', 'Couches', 'Pool tables'], 'rey', 'Dark, cozy, and someone is always playing pool.'],
  ['plein', 'Plein Air Café', 'Woodlawn Ave, by the bookstore', 'OFF·PA', 'cafe', ['Off campus', 'Pastries', 'No outlets'], 'pla', 'Peak laptop-and-latte. Bring a full battery.'],
  ['cobb', 'Cobb Coffee Shop', 'Cobb Hall basement', 'COB·B', 'cafe', ['Coffee', 'Between classes', 'Loud'], 'cob', 'Ten minutes between classes, not ten pages of reading.'],
  ['harpercafe', 'Harper Café', 'Harper Memorial Library, 3rd floor', 'HAR·3C', 'cafe', ['Coffee', 'Late night'], 'har', 'Fuel stop next to the reading room.'],
  ['build', 'Build Coffee', 'Blackstone Ave, south of campus', 'OFF·BC', 'cafe', ['Off campus', 'Quiet', 'Zines'], 'bld', 'A real walk, which is why it is calm.'],
].map(a => ({ id: a[0], name: a[1], where: a[2], code: a[3], kind: a[4], tags: a[5], bldg: a[6], note: a[7] }));

export const KINDS = [['all', 'All'], ['silent', 'Silent'], ['quiet', 'Quiet'], ['social', 'Social'], ['cafe', 'Café']];

export const METERS = [
  ['lockin', 'Lock-in level', 'How much work actually gets done here.'],
  ['larp', 'Larpability', 'How good it is for looking like you are studying.'],
  ['yap', 'Yap level', 'How much talking is going on.'],
  ['outlets', 'Outlet luck', 'Your odds of finding a working outlet.'],
];

// Campus pins, laid out roughly. North is up. [short name, x, y, full name]
export const BLDG = {
  man: ['Mansueto', 106, 58, 'Mansueto Library'], reg: ['Regenstein', 156, 58, 'Regenstein Library'], cre: ['Crerar', 58, 128, 'Crerar Library'],
  rey: ['Reynolds Club', 204, 96, 'Reynolds Club'], eck: ['Eckhart', 186, 128, 'Eckhart Hall'], swi: ['Swift Hall', 150, 158, 'Swift Hall'],
  cob: ['Cobb Hall', 108, 190, 'Cobb Hall'], har: ['Harper', 150, 226, 'Harper Memorial Library'], sai: ['Saieh', 238, 116, 'Saieh Hall for Economics'],
  pla: ['Plein Air', 280, 124, 'Plein Air Café'], bth: ['Booth', 262, 178, 'Harper Center, Booth School'], log: ['Logan Center', 52, 326, 'Logan Center for the Arts'],
  law: ['Law School', 160, 326, 'Law School'], bld: ['Build Coffee', 318, 386, 'Build Coffee'],
};

// Floor sketches: [label, x, y, w, h, spotId]. Drawn by hand, not surveyed.
export const FLOORS = {
  reg: { order: ['5', '4', '3', '2', '1', 'A', 'B'], start: '1', f: {
    '5': [['Reading room', 20, 20, 170, 90, 'reg5'], ['Stacks', 200, 20, 100, 160], ['Carrels', 20, 120, 170, 60]],
    '4': [['Stacks', 20, 20, 180, 160], ['Carrels', 210, 20, 90, 160]],
    '3': [['Stacks', 20, 20, 180, 160], ['Carrels', 210, 20, 90, 160]],
    '2': [['Reading room', 20, 20, 170, 100, 'reg2'], ['Stacks', 200, 20, 100, 160], ['Group rooms', 20, 130, 170, 50]],
    '1': [['Ex Libris Café', 20, 20, 110, 80, 'exlibris'], ['Lobby and circulation', 140, 20, 160, 80], ['Group tables', 20, 110, 180, 70], ['To Mansueto', 210, 110, 90, 70]],
    'A': [['All-night study', 20, 20, 200, 110, 'alevel'], ['Group tables', 20, 140, 200, 40], ['Vending', 230, 20, 70, 160]],
    'B': [['Stacks', 20, 20, 280, 160]] } },
  har: { order: ['3'], start: '3', f: {
    '3': [['Main reading room', 20, 20, 280, 80, 'harper'], ['North reading room', 20, 110, 150, 70], ['Harper Café', 180, 110, 120, 70, 'harpercafe']] } },
};

// [code, title, spot where the class tends to study]
export const COURSES = [
  ['MATH 15300', 'Calculus III', 'eckhart'], ['MATH 16100', 'Honors Calculus I', 'eckhart'], ['ECON 20000', 'Elements of Economic Analysis I', 'saieh'],
  ['CMSC 14100', 'Introduction to Computer Science I', 'crerar'], ['CHEM 11100', 'Comprehensive General Chemistry I', 'crerar'],
  ['PHYS 13100', 'Mechanics', 'reg2'], ['SOSC 15100', 'Classics of Social and Political Thought I', 'harper'], ['HUMA 12300', 'Human Being and Citizen I', 'grounds'],
];
export const RES_KINDS = ['Study guide', 'Notes', 'Practice', 'Tip'];
