import { getSupabaseClient } from "@/lib/supabase";

type AuthInput = {
	email: string;
	password: string;
};

type SignUpInput = AuthInput & {
	displayName?: string;
};

type AuthResult = {
	ok: boolean;
	message: string;
};

export async function signInUser({ email, password }: AuthInput): Promise<AuthResult> {
	try {
		const { error } = await getSupabaseClient().auth.signInWithPassword({
			email,
			password,
		});

 		if (error) {
			return { ok: false, message: error.message };
		}

		return { ok: true, message: "Sesion iniciada correctamente." };
	} catch (error) {
		const message = error instanceof Error ? error.message : "No se pudo iniciar sesion.";
		return { ok: false, message };
	}
}

export async function signUpUser({ email, password, displayName }: SignUpInput): Promise<AuthResult> {
	try {
		const { error } = await getSupabaseClient().auth.signUp({
			email,
			password,
			options: {
				data: {
					display_name: displayName ?? "",
				},
			},
		});

 		if (error) {
			return { ok: false, message: error.message };
		}

		return {
			ok: true,
			message: "Cuenta creada. Revisa tu email para confirmar el registro.",
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : "No se pudo crear la cuenta.";
		return { ok: false, message };
	}
}
