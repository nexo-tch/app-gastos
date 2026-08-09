CREATE TABLE "abonos" (
	"id" text NOT NULL,
	"usuario_id" text NOT NULL,
	"persona_id" text NOT NULL,
	"monto" integer NOT NULL,
	"pagado_en" timestamp with time zone NOT NULL,
	CONSTRAINT "abonos_usuario_id_id_pk" PRIMARY KEY("usuario_id","id")
);
--> statement-breakpoint
CREATE TABLE "asignaciones" (
	"id" text NOT NULL,
	"usuario_id" text NOT NULL,
	"abono_id" text NOT NULL,
	"reparto_id" text NOT NULL,
	"monto" integer NOT NULL,
	CONSTRAINT "asignaciones_usuario_id_id_pk" PRIMARY KEY("usuario_id","id")
);
--> statement-breakpoint
CREATE TABLE "categorias" (
	"id" text NOT NULL,
	"usuario_id" text NOT NULL,
	"nombre" text NOT NULL,
	"color" text NOT NULL,
	"archivada" boolean DEFAULT false NOT NULL,
	"posicion" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "categorias_usuario_id_id_pk" PRIMARY KEY("usuario_id","id")
);
--> statement-breakpoint
CREATE TABLE "cuentas" (
	"id" text NOT NULL,
	"usuario_id" text NOT NULL,
	"nombre" text NOT NULL,
	"tipo" text NOT NULL,
	"posicion" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "cuentas_usuario_id_id_pk" PRIMARY KEY("usuario_id","id")
);
--> statement-breakpoint
CREATE TABLE "fijos" (
	"id" text NOT NULL,
	"usuario_id" text NOT NULL,
	"nombre" text NOT NULL,
	"categoria_id" text,
	"monto" integer NOT NULL,
	"dia_del_mes" integer DEFAULT 1 NOT NULL,
	"variable" boolean DEFAULT false NOT NULL,
	"archivado" boolean DEFAULT false NOT NULL,
	"posicion" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "fijos_usuario_id_id_pk" PRIMARY KEY("usuario_id","id")
);
--> statement-breakpoint
CREATE TABLE "gastos" (
	"id" text NOT NULL,
	"usuario_id" text NOT NULL,
	"cuenta_id" text,
	"categoria_id" text,
	"estado" text DEFAULT 'confirmed' NOT NULL,
	"origen" text DEFAULT 'manual' NOT NULL,
	"monto_total" integer NOT NULL,
	"mi_parte" integer NOT NULL,
	"moneda" text DEFAULT 'COP' NOT NULL,
	"comercio" text,
	"comercio_normalizado" text,
	"descripcion" text,
	"ocurrio_en" timestamp with time zone NOT NULL,
	"confirmado_en" timestamp with time zone,
	"fijo_id" text,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"borrado_en" timestamp with time zone,
	CONSTRAINT "gastos_usuario_id_id_pk" PRIMARY KEY("usuario_id","id")
);
--> statement-breakpoint
CREATE TABLE "instancias" (
	"id" text NOT NULL,
	"usuario_id" text NOT NULL,
	"fijo_id" text NOT NULL,
	"mes" text NOT NULL,
	"monto_planeado" integer NOT NULL,
	"estado" text DEFAULT 'planned' NOT NULL,
	"gasto_id" text,
	CONSTRAINT "instancias_usuario_id_id_pk" PRIMARY KEY("usuario_id","id")
);
--> statement-breakpoint
CREATE TABLE "personas" (
	"id" text NOT NULL,
	"usuario_id" text NOT NULL,
	"nombre" text NOT NULL,
	"posicion" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "personas_usuario_id_id_pk" PRIMARY KEY("usuario_id","id")
);
--> statement-breakpoint
CREATE TABLE "presupuestos" (
	"usuario_id" text NOT NULL,
	"mes" text NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "presupuestos_usuario_id_mes_pk" PRIMARY KEY("usuario_id","mes")
);
--> statement-breakpoint
CREATE TABLE "repartos" (
	"id" text NOT NULL,
	"usuario_id" text NOT NULL,
	"gasto_id" text NOT NULL,
	"persona_id" text NOT NULL,
	"monto" integer NOT NULL,
	CONSTRAINT "repartos_usuario_id_id_pk" PRIMARY KEY("usuario_id","id")
);
--> statement-breakpoint
CREATE TABLE "sesiones" (
	"huella" text PRIMARY KEY NOT NULL,
	"usuario_id" text NOT NULL,
	"creada_en" timestamp with time zone DEFAULT now() NOT NULL,
	"expira_en" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topes" (
	"usuario_id" text NOT NULL,
	"mes" text NOT NULL,
	"categoria_id" text NOT NULL,
	"monto" integer NOT NULL,
	CONSTRAINT "topes_usuario_id_mes_categoria_id_pk" PRIMARY KEY("usuario_id","mes","categoria_id")
);
--> statement-breakpoint
CREATE TABLE "usuarios" (
	"id" text PRIMARY KEY NOT NULL,
	"correo" text NOT NULL,
	"clave" text NOT NULL,
	"nombre" text NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "abonos" ADD CONSTRAINT "abonos_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asignaciones" ADD CONSTRAINT "asignaciones_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categorias" ADD CONSTRAINT "categorias_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cuentas" ADD CONSTRAINT "cuentas_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fijos" ADD CONSTRAINT "fijos_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gastos" ADD CONSTRAINT "gastos_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instancias" ADD CONSTRAINT "instancias_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personas" ADD CONSTRAINT "personas_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presupuestos" ADD CONSTRAINT "presupuestos_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repartos" ADD CONSTRAINT "repartos_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sesiones" ADD CONSTRAINT "sesiones_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topes" ADD CONSTRAINT "topes_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gastos_fecha_idx" ON "gastos" USING btree ("usuario_id","ocurrio_en");--> statement-breakpoint
CREATE INDEX "instancias_mes_idx" ON "instancias" USING btree ("usuario_id","mes");--> statement-breakpoint
CREATE INDEX "repartos_gasto_idx" ON "repartos" USING btree ("usuario_id","gasto_id");--> statement-breakpoint
CREATE INDEX "sesiones_usuario_idx" ON "sesiones" USING btree ("usuario_id");--> statement-breakpoint
CREATE UNIQUE INDEX "usuarios_correo_idx" ON "usuarios" USING btree ("correo");