// Re-implements the frame extraction to confirm the logic.
const ASK_OPEN = "[[MODK_ASK]]", ASK_CLOSE = "[[/MODK_ASK]]";
const stream = `Bien sûr !\n${ASK_OPEN}{"question":"Langue ?","options":["FR","EN"],"allowFreeText":true}${ASK_CLOSE}`;
const open = stream.indexOf(ASK_OPEN), close = stream.indexOf(ASK_CLOSE);
const visible = stream.slice(0, open);
const ask = JSON.parse(stream.slice(open + ASK_OPEN.length, close));
console.log("visible:", JSON.stringify(visible.trim()));
console.log("ask:", ask);
console.log("PASS:", visible.trim() === "Bien sûr !" && ask.question === "Langue ?" && ask.options.length === 2);
