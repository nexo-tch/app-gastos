CREATE TABLE "pasivos" (
	"id" text NOT NULL,
	"usuario_id" text NOT NULL,
	"nombre" text NOT NULL,
	"tipo" text NOT NULL,
	"saldo" integer DEFAULT 0 NOT NULL,
	"cupo" integer,
	"cuenta_id" text,
	"persona_id" text,
	"notas" text,
	"posicion" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "pasivos_usuario_id_id_pk" PRIMARY KEY("usuario_id","id")
);
--> statement-breakpoint
CREATE TABLE "pasivo_movimientos" (
	"id" text NOT NULL,
	"usuario_id" text NOT NULL,
	"pasivo_id" text NOT NULL,
	"tipo" text NOT NULL,
	"monto" integer,
	"saldo_despues" integer NOT NULL,
	"nota" text,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pasivo_movimientos_usuario_id_id_pk" PRIMARY KEY("usuario_id","id")
);
--> statement-breakpoint
ALTER TABLE "pasivos" ADD CONSTRAINT "pasivos_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pasivo_movimientos" ADD CONSTRAINT "pasivo_movimientos_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "pasivo_movimientos_pasivo_idx" ON "pasivo_movimientos" USING btree ("usuario_id","pasivo_id","creado_en");
