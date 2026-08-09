CREATE TABLE "deudas" (
	"id" text NOT NULL,
	"usuario_id" text NOT NULL,
	"persona_id" text NOT NULL,
	"monto" integer NOT NULL,
	"descripcion" text,
	"ocurrio_en" timestamp with time zone NOT NULL,
	"pagada_en" timestamp with time zone,
	CONSTRAINT "deudas_usuario_id_id_pk" PRIMARY KEY("usuario_id","id")
);
--> statement-breakpoint
ALTER TABLE "deudas" ADD CONSTRAINT "deudas_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;