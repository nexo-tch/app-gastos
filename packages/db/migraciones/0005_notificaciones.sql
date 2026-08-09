CREATE TABLE "notificaciones" (
	"id" text NOT NULL,
	"usuario_id" text NOT NULL,
	"tipo" text NOT NULL,
	"reparto_id" text NOT NULL,
	"emisor_correo" text NOT NULL,
	"emisor_nombre" text,
	"carga" text NOT NULL,
	"leida_en" timestamp with time zone,
	"creada_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notificaciones_usuario_id_id_pk" PRIMARY KEY("usuario_id","id")
);
--> statement-breakpoint
ALTER TABLE "notificaciones" ADD CONSTRAINT "notificaciones_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "notificaciones_pendientes_idx" ON "notificaciones" USING btree ("usuario_id","creada_en");
