export type GobrickColor = {
	id: number;
	name: string;
	blName?: string;
	hex: string;
	uniqueFlag?: boolean;
};

export const gobrickColors: GobrickColor[] = [
	{ id: 1, name: "White", hex: "#ffffff" },
	{ id: 2, name: "Light Gray", hex: "#d9d9d9" },
	{ id: 3, name: "Dark Gray", hex: "#8a8d91" },
	{ id: 4, name: "Black", hex: "#111111" },
	{ id: 5, name: "Red", hex: "#c91a09" },
	{ id: 6, name: "Dark Red", hex: "#720e0f" },
	{ id: 7, name: "Orange", hex: "#f57c00" },
	{ id: 8, name: "Yellow", hex: "#f2cd37" },
	{ id: 9, name: "Lime", hex: "#a0bc1a" },
	{ id: 10, name: "Green", hex: "#237841" },
	{ id: 11, name: "Dark Green", hex: "#184632" },
	{ id: 12, name: "Sand Green", hex: "#7c9c8b" },
	{ id: 13, name: "Blue", hex: "#0055bf" },
	{ id: 14, name: "Dark Blue", hex: "#143044" },
	{ id: 15, name: "Medium Blue", hex: "#5a93db" },
	{ id: 16, name: "Azure", hex: "#42c0fb" },
	{ id: 17, name: "Tan", hex: "#e4cd9e" },
	{ id: 18, name: "Dark Tan", hex: "#958a73" },
	{ id: 19, name: "Reddish Brown", hex: "#582a12" },
	{ id: 20, name: "Dark Brown", hex: "#352100" },
	{ id: 21, name: "Nougat", hex: "#d09168" },
	{ id: 22, name: "Dark Nougat", hex: "#ad6140" },
	{ id: 23, name: "Pink", hex: "#fc97ac" },
	{ id: 24, name: "Dark Pink", hex: "#c870a0" },
	{ id: 25, name: "Purple", hex: "#81007b" },
	{ id: 26, name: "Dark Purple", hex: "#3f1f5b" },
	{ id: 27, name: "Trans Clear", hex: "#f4f4f4" },
	{ id: 28, name: "Trans Light Blue", hex: "#c1dff0" },
	{ id: 29, name: "Trans Green", hex: "#84b68d" },
	{ id: 30, name: "Trans Red", hex: "#b52c20" },
	{ id: 31, name: "Pearl Gold", hex: "#aa7f2e" },
	{ id: 32, name: "Metallic Silver", hex: "#9ca3af" },
];
