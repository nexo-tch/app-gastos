CREATE TABLE "viajes" (
	"id" text PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"moneda_base" text NOT NULL,
	"tasas" text DEFAULT '{}' NOT NULL,
	"codigo" text NOT NULL,
	"creado_por" text NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "viaje_miembros" (
	"viaje_id" text NOT NULL,
	"usuario_id" text NOT NULL,
	"unido_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "viaje_miembros_viaje_id_usuario_id_pk" PRIMARY KEY("viaje_id","usuario_id")
);
--> statement-breakpoint
CREATE TABLE "viaje_gastos" (
	"id" text NOT NULL,
	"viaje_id" text NOT NULL,
	"creado_por" text NOT NULL,
	"descripcion" text NOT NULL,
	"categoria" text NOT NULL,
	"moneda" text NOT NULL,
	"monto_total" integer NOT NULL,
	"modo" text NOT NULL,
	"ocurrio_en" timestamp with time zone NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "viaje_gastos_viaje_id_id_pk" PRIMARY KEY("viaje_id","id")
);
--> statement-breakpoint
CREATE TABLE "viaje_partes" (
	"viaje_id" text NOT NULL,
	"gasto_id" text NOT NULL,
	"usuario_id" text NOT NULL,
	"pagado" integer DEFAULT 0 NOT NULL,
	"debe" integer DEFAULT 0 NOT NULL,
	"participa" boolean DEFAULT false NOT NULL,
	"peso" integer,
	CONSTRAINT "viaje_partes_viaje_id_gasto_id_usuario_id_pk" PRIMARY KEY("viaje_id","gasto_id","usuario_id")
);
--> statement-breakpoint
CREATE TABLE "viaje_pagos" (
	"id" text NOT NULL,
	"viaje_id" text NOT NULL,
	"de" text NOT NULL,
	"a" text NOT NULL,
	"monto" integer NOT NULL,
	"registrado_por" text NOT NULL,
	"ocurrio_en" timestamp with time zone NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "viaje_pagos_viaje_id_id_pk" PRIMARY KEY("viaje_id","id")
);
--> statement-breakpoint
ALTER TABLE "viajes" ADD CONSTRAINT "viajes_creado_por_usuarios_id_fk" FOREIGN KEY ("creado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "viaje_miembros" ADD CONSTRAINT "viaje_miembros_viaje_id_viajes_id_fk" FOREIGN KEY ("viaje_id") REFERENCES "public"."viajes"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "viaje_miembros" ADD CONSTRAINT "viaje_miembros_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "viaje_gastos" ADD CONSTRAINT "viaje_gastos_viaje_id_viajes_id_fk" FOREIGN KEY ("viaje_id") REFERENCES "public"."viajes"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "viaje_partes" ADD CONSTRAINT "viaje_partes_viaje_id_viajes_id_fk" FOREIGN KEY ("viaje_id") REFERENCES "public"."viajes"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "viaje_pagos" ADD CONSTRAINT "viaje_pagos_viaje_id_viajes_id_fk" FOREIGN KEY ("viaje_id") REFERENCES "public"."viajes"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "viajes_codigo_idx" ON "viajes" USING btree ("codigo");
--> statement-breakpoint
CREATE INDEX "viaje_miembros_usuario_idx" ON "viaje_miembros" USING btree ("usuario_id");
