const loadingMessages = [
	"Contruyendo con bricks de 1x1",
	"Desarmando un set grande",
	"Clasificando piecitas",
	"intercambiando Minifiguras",
	"Limpiando el povo con un pincelito",
];

export function getRandomLoadingMessage() {
	return loadingMessages[Math.floor(Math.random() * loadingMessages.length)] ?? "Cargando...";
}
