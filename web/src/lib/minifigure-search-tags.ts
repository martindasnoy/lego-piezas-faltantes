const MINIFIGURE_TAGS_BY_SET_NUM: Record<string, string[]> = {
	"8683-1": ["tribal", "hunter", "forest", "historic", "tribu", "cazador", "selva", "prehistorico"],
	"8683-2": ["cheerleader", "cheer", "cheerleading", "sports", "school", "porrista", "alentadora", "animadora"],
	"8683-3": ["caveman", "cave", "prehistoric", "stone age", "cavernicola", "hombre de las cavernas", "prehistorico"],
	"8683-4": ["circus", "clown", "funny", "payaso", "circo", "comedia"],
	"8683-5": ["zombie", "undead", "horror", "spooky", "terror", "muerto vivo", "halloween"],
	"8683-6": ["skater", "skate", "skateboard", "sports", "patinador", "patineta", "deporte"],
	"8683-7": ["robot", "android", "space", "future", "tecnologia", "futurista"],
	"8683-8": ["dummy", "demolition", "crash", "test", "muneco", "prueba", "choque"],
	"8683-9": ["magician", "magic", "wizard", "mago", "magia", "ilusionista"],
	"8683-10": ["wrestler", "wrestling", "fighter", "sports", "luchador", "lucha", "deporte"],
	"8683-11": ["nurse", "hospital", "medical", "health", "enfermera", "medico", "salud", "medicina"],
	"8683-12": ["ninja", "japan", "martial", "samurai", "artes marciales", "sigilo"],
	"8683-13": ["spaceman", "astronaut", "space", "galaxy", "astronauta", "espacio", "galaxia"],
	"8683-14": ["forestman", "forest", "archer", "medieval", "bosque", "arquero", "robin hood"],
	"8683-15": ["deep sea diver", "diver", "ocean", "sea", "scuba", "buzo", "oceano", "marino"],
	"8683-16": ["cowboy", "western", "wild west", "vaquero", "oeste", "pistolero"],
};

const PHRASE_TAGS: Array<[string, string[]]> = [
	["deep sea", ["diver", "buzo", "oceano", "mar", "submarino"]],
	["wild west", ["cowboy", "vaquero", "oeste"]],
	["space", ["espacio", "astronauta", "galaxia", "sci fi"]],
	["series", ["serie", "coleccion", "coleccionable"]],
	["collectible", ["coleccionable", "coleccion"]],
	["collectable", ["coleccionable", "coleccion"]],
	["harry potter", ["magia", "hechicero", "wizard", "fantasia"]],
	["marvel", ["superheroe", "heroes", "comic"]],
	["dc", ["superheroe", "heroes", "comic"]],
	["simpsons", ["cartoon", "animado", "tv"]],
	["muppets", ["tv", "personaje", "show"]],
	["looney tunes", ["cartoon", "animado", "tv"]],
	["dungeons dragons", ["fantasia", "rol", "dnd", "dragon"]],
];

const TOKEN_TAGS: Record<string, string[]> = {
	cheerleader: ["porrista", "alentadora", "animadora", "sports", "deporte"],
	caveman: ["cavernicola", "prehistorico"],
	clown: ["payaso", "circo"],
	zombie: ["undead", "muerto vivo", "terror", "halloween"],
	skater: ["patinador", "patineta", "deporte"],
	robot: ["android", "tecnologia", "futuro"],
	magician: ["mago", "magia", "ilusionista"],
	wrestler: ["luchador", "lucha", "deporte"],
	nurse: ["enfermera", "hospital", "medico", "salud"],
	ninja: ["samurai", "japon", "artes marciales"],
	spaceman: ["astronauta", "espacio", "galaxia"],
	astronaut: ["astronauta", "espacio", "galaxia"],
	forestman: ["bosque", "arquero", "medieval"],
	diver: ["buzo", "oceano", "mar", "submarino"],
	cowboy: ["vaquero", "oeste", "western"],
	vampire: ["vampiro", "terror", "halloween"],
	witch: ["bruja", "magia", "hechicera"],
	wizard: ["mago", "magia", "hechicero"],
	ghost: ["fantasma", "terror", "spooky"],
	skeleton: ["esqueleto", "terror"],
	werewolf: ["hombre lobo", "lobo", "terror"],
	mummy: ["momia", "egipto", "terror"],
	pirate: ["pirata", "mar", "aventura"],
	knight: ["caballero", "medieval", "castillo"],
	viking: ["nordico", "guerrero", "medieval"],
	samurai: ["japon", "guerrero", "katana"],
	elf: ["elfo", "fantasia"],
	dwarf: ["enano", "fantasia"],
	orc: ["orco", "fantasia"],
	goblin: ["duende", "fantasia"],
	dragon: ["dragon", "fantasia"],
	unicorn: ["unicornio", "fantasia"],
	mermaid: ["sirena", "oceano", "fantasia"],
	fairy: ["hada", "fantasia"],
	police: ["policia", "seguridad"],
	firefighter: ["bombero", "rescate"],
	scientist: ["cientifico", "laboratorio", "ciencia"],
	doctor: ["medico", "hospital", "salud"],
	surgeon: ["cirujano", "hospital", "salud"],
	chef: ["cocinero", "cocina", "comida"],
	baker: ["panadero", "cocina", "comida"],
	musician: ["musico", "musica", "banda"],
	athlete: ["atleta", "deporte"],
	football: ["futbol", "deporte"],
	soccer: ["futbol", "deporte"],
	rugby: ["rugby", "deporte"],
	tennis: ["tenis", "deporte"],
	boxing: ["boxeo", "deporte"],
	surfer: ["surf", "deporte", "playa"],
	skier: ["esqui", "deporte", "nieve"],
	pilot: ["piloto", "aviacion", "vuelo"],
	captain: ["capitan", "mar", "barco"],
	marine: ["marino", "barco", "oceano"],
	shark: ["tiburon", "oceano"],
	bird: ["ave", "animal"],
	cat: ["gato", "animal"],
	dog: ["perro", "animal"],
	horse: ["caballo", "animal"],
	batman: ["superheroe", "dc", "comic"],
	superman: ["superheroe", "dc", "comic"],
	spiderman: ["superheroe", "marvel", "comic"],
	joker: ["villano", "dc", "comic"],
	disney: ["personaje", "pelicula", "animado"],
	harry: ["potter", "magia", "wizard", "fantasia"],
	potter: ["harry", "magia", "wizard", "fantasia"],
	muppets: ["tv", "show", "personajes"],
	simpsons: ["tv", "cartoon", "animado"],
	marvel: ["superheroe", "comic", "mcu"],
	dc: ["superheroe", "comic"],
};

function normalizeSetNum(rawSetNum: string) {
	return rawSetNum.trim().toUpperCase();
}

function normalizeText(value: string) {
	return value
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[^a-z0-9\s]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function tokenize(value: string) {
	if (!value) return [] as string[];
	return value.split(" ").filter((token) => token.length > 1);
}

function singularize(token: string) {
	if (token.endsWith("ies") && token.length > 4) return `${token.slice(0, -3)}y`;
	if (token.endsWith("es") && token.length > 4) return token.slice(0, -2);
	if (token.endsWith("s") && token.length > 3) return token.slice(0, -1);
	return token;
}

function buildAutoTags(name: string, themeName: string) {
	const normalizedName = normalizeText(name);
	const normalizedTheme = normalizeText(themeName);
	const text = `${normalizedName} ${normalizedTheme}`.trim();
	const tags = new Set<string>();

	if (!text) return [] as string[];

	for (const [phrase, mapped] of PHRASE_TAGS) {
		if (!text.includes(phrase)) continue;
		tags.add(phrase);
		for (const value of mapped) tags.add(normalizeText(value));
	}

	const tokens = tokenize(text);
	for (const token of tokens) {
		tags.add(token);
		const singular = singularize(token);
		tags.add(singular);

		const mappedDirect = TOKEN_TAGS[token] ?? [];
		for (const value of mappedDirect) tags.add(normalizeText(value));

		const mappedSingular = TOKEN_TAGS[singular] ?? [];
		for (const value of mappedSingular) tags.add(normalizeText(value));
	}

	return [...tags].filter((value) => value.length > 1);
}

export function getHiddenSearchTagsForMinifigure(setNum: string, figureName = "", themeName = "") {
	const normalizedSetNum = normalizeSetNum(setNum);
	const specific = MINIFIGURE_TAGS_BY_SET_NUM[normalizedSetNum] ?? [];
	const generated = buildAutoTags(figureName, themeName);

	return [...new Set([...specific, ...generated])];
}
