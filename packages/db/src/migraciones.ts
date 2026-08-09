/**
 * Generado por scripts/empaquetar.mjs a partir de migraciones/*.sql.
 * No editar a mano: se reescribe con cada `npm run generar`.
 */
export interface Migracion {
  nombre: string;
  sentencias: string[];
}

export const MIGRACIONES: Migracion[] = [
  {
    nombre: "0000_inicial",
    sentencias: [
      "CREATE TABLE \"abonos\" (\n\t\"id\" text NOT NULL,\n\t\"usuario_id\" text NOT NULL,\n\t\"persona_id\" text NOT NULL,\n\t\"monto\" integer NOT NULL,\n\t\"pagado_en\" timestamp with time zone NOT NULL,\n\tCONSTRAINT \"abonos_usuario_id_id_pk\" PRIMARY KEY(\"usuario_id\",\"id\")\n);",
      "CREATE TABLE \"asignaciones\" (\n\t\"id\" text NOT NULL,\n\t\"usuario_id\" text NOT NULL,\n\t\"abono_id\" text NOT NULL,\n\t\"reparto_id\" text NOT NULL,\n\t\"monto\" integer NOT NULL,\n\tCONSTRAINT \"asignaciones_usuario_id_id_pk\" PRIMARY KEY(\"usuario_id\",\"id\")\n);",
      "CREATE TABLE \"categorias\" (\n\t\"id\" text NOT NULL,\n\t\"usuario_id\" text NOT NULL,\n\t\"nombre\" text NOT NULL,\n\t\"color\" text NOT NULL,\n\t\"archivada\" boolean DEFAULT false NOT NULL,\n\t\"posicion\" integer DEFAULT 0 NOT NULL,\n\tCONSTRAINT \"categorias_usuario_id_id_pk\" PRIMARY KEY(\"usuario_id\",\"id\")\n);",
      "CREATE TABLE \"cuentas\" (\n\t\"id\" text NOT NULL,\n\t\"usuario_id\" text NOT NULL,\n\t\"nombre\" text NOT NULL,\n\t\"tipo\" text NOT NULL,\n\t\"posicion\" integer DEFAULT 0 NOT NULL,\n\tCONSTRAINT \"cuentas_usuario_id_id_pk\" PRIMARY KEY(\"usuario_id\",\"id\")\n);",
      "CREATE TABLE \"fijos\" (\n\t\"id\" text NOT NULL,\n\t\"usuario_id\" text NOT NULL,\n\t\"nombre\" text NOT NULL,\n\t\"categoria_id\" text,\n\t\"monto\" integer NOT NULL,\n\t\"dia_del_mes\" integer DEFAULT 1 NOT NULL,\n\t\"variable\" boolean DEFAULT false NOT NULL,\n\t\"archivado\" boolean DEFAULT false NOT NULL,\n\t\"posicion\" integer DEFAULT 0 NOT NULL,\n\tCONSTRAINT \"fijos_usuario_id_id_pk\" PRIMARY KEY(\"usuario_id\",\"id\")\n);",
      "CREATE TABLE \"gastos\" (\n\t\"id\" text NOT NULL,\n\t\"usuario_id\" text NOT NULL,\n\t\"cuenta_id\" text,\n\t\"categoria_id\" text,\n\t\"estado\" text DEFAULT 'confirmed' NOT NULL,\n\t\"origen\" text DEFAULT 'manual' NOT NULL,\n\t\"monto_total\" integer NOT NULL,\n\t\"mi_parte\" integer NOT NULL,\n\t\"moneda\" text DEFAULT 'COP' NOT NULL,\n\t\"comercio\" text,\n\t\"comercio_normalizado\" text,\n\t\"descripcion\" text,\n\t\"ocurrio_en\" timestamp with time zone NOT NULL,\n\t\"confirmado_en\" timestamp with time zone,\n\t\"fijo_id\" text,\n\t\"creado_en\" timestamp with time zone DEFAULT now() NOT NULL,\n\t\"actualizado_en\" timestamp with time zone DEFAULT now() NOT NULL,\n\t\"borrado_en\" timestamp with time zone,\n\tCONSTRAINT \"gastos_usuario_id_id_pk\" PRIMARY KEY(\"usuario_id\",\"id\")\n);",
      "CREATE TABLE \"instancias\" (\n\t\"id\" text NOT NULL,\n\t\"usuario_id\" text NOT NULL,\n\t\"fijo_id\" text NOT NULL,\n\t\"mes\" text NOT NULL,\n\t\"monto_planeado\" integer NOT NULL,\n\t\"estado\" text DEFAULT 'planned' NOT NULL,\n\t\"gasto_id\" text,\n\tCONSTRAINT \"instancias_usuario_id_id_pk\" PRIMARY KEY(\"usuario_id\",\"id\")\n);",
      "CREATE TABLE \"personas\" (\n\t\"id\" text NOT NULL,\n\t\"usuario_id\" text NOT NULL,\n\t\"nombre\" text NOT NULL,\n\t\"posicion\" integer DEFAULT 0 NOT NULL,\n\tCONSTRAINT \"personas_usuario_id_id_pk\" PRIMARY KEY(\"usuario_id\",\"id\")\n);",
      "CREATE TABLE \"presupuestos\" (\n\t\"usuario_id\" text NOT NULL,\n\t\"mes\" text NOT NULL,\n\t\"total\" integer DEFAULT 0 NOT NULL,\n\tCONSTRAINT \"presupuestos_usuario_id_mes_pk\" PRIMARY KEY(\"usuario_id\",\"mes\")\n);",
      "CREATE TABLE \"repartos\" (\n\t\"id\" text NOT NULL,\n\t\"usuario_id\" text NOT NULL,\n\t\"gasto_id\" text NOT NULL,\n\t\"persona_id\" text NOT NULL,\n\t\"monto\" integer NOT NULL,\n\tCONSTRAINT \"repartos_usuario_id_id_pk\" PRIMARY KEY(\"usuario_id\",\"id\")\n);",
      "CREATE TABLE \"sesiones\" (\n\t\"huella\" text PRIMARY KEY NOT NULL,\n\t\"usuario_id\" text NOT NULL,\n\t\"creada_en\" timestamp with time zone DEFAULT now() NOT NULL,\n\t\"expira_en\" timestamp with time zone NOT NULL\n);",
      "CREATE TABLE \"topes\" (\n\t\"usuario_id\" text NOT NULL,\n\t\"mes\" text NOT NULL,\n\t\"categoria_id\" text NOT NULL,\n\t\"monto\" integer NOT NULL,\n\tCONSTRAINT \"topes_usuario_id_mes_categoria_id_pk\" PRIMARY KEY(\"usuario_id\",\"mes\",\"categoria_id\")\n);",
      "CREATE TABLE \"usuarios\" (\n\t\"id\" text PRIMARY KEY NOT NULL,\n\t\"correo\" text NOT NULL,\n\t\"clave\" text NOT NULL,\n\t\"nombre\" text NOT NULL,\n\t\"revision\" integer DEFAULT 0 NOT NULL,\n\t\"creado_en\" timestamp with time zone DEFAULT now() NOT NULL\n);",
      "ALTER TABLE \"abonos\" ADD CONSTRAINT \"abonos_usuario_id_usuarios_id_fk\" FOREIGN KEY (\"usuario_id\") REFERENCES \"public\".\"usuarios\"(\"id\") ON DELETE cascade ON UPDATE no action;",
      "ALTER TABLE \"asignaciones\" ADD CONSTRAINT \"asignaciones_usuario_id_usuarios_id_fk\" FOREIGN KEY (\"usuario_id\") REFERENCES \"public\".\"usuarios\"(\"id\") ON DELETE cascade ON UPDATE no action;",
      "ALTER TABLE \"categorias\" ADD CONSTRAINT \"categorias_usuario_id_usuarios_id_fk\" FOREIGN KEY (\"usuario_id\") REFERENCES \"public\".\"usuarios\"(\"id\") ON DELETE cascade ON UPDATE no action;",
      "ALTER TABLE \"cuentas\" ADD CONSTRAINT \"cuentas_usuario_id_usuarios_id_fk\" FOREIGN KEY (\"usuario_id\") REFERENCES \"public\".\"usuarios\"(\"id\") ON DELETE cascade ON UPDATE no action;",
      "ALTER TABLE \"fijos\" ADD CONSTRAINT \"fijos_usuario_id_usuarios_id_fk\" FOREIGN KEY (\"usuario_id\") REFERENCES \"public\".\"usuarios\"(\"id\") ON DELETE cascade ON UPDATE no action;",
      "ALTER TABLE \"gastos\" ADD CONSTRAINT \"gastos_usuario_id_usuarios_id_fk\" FOREIGN KEY (\"usuario_id\") REFERENCES \"public\".\"usuarios\"(\"id\") ON DELETE cascade ON UPDATE no action;",
      "ALTER TABLE \"instancias\" ADD CONSTRAINT \"instancias_usuario_id_usuarios_id_fk\" FOREIGN KEY (\"usuario_id\") REFERENCES \"public\".\"usuarios\"(\"id\") ON DELETE cascade ON UPDATE no action;",
      "ALTER TABLE \"personas\" ADD CONSTRAINT \"personas_usuario_id_usuarios_id_fk\" FOREIGN KEY (\"usuario_id\") REFERENCES \"public\".\"usuarios\"(\"id\") ON DELETE cascade ON UPDATE no action;",
      "ALTER TABLE \"presupuestos\" ADD CONSTRAINT \"presupuestos_usuario_id_usuarios_id_fk\" FOREIGN KEY (\"usuario_id\") REFERENCES \"public\".\"usuarios\"(\"id\") ON DELETE cascade ON UPDATE no action;",
      "ALTER TABLE \"repartos\" ADD CONSTRAINT \"repartos_usuario_id_usuarios_id_fk\" FOREIGN KEY (\"usuario_id\") REFERENCES \"public\".\"usuarios\"(\"id\") ON DELETE cascade ON UPDATE no action;",
      "ALTER TABLE \"sesiones\" ADD CONSTRAINT \"sesiones_usuario_id_usuarios_id_fk\" FOREIGN KEY (\"usuario_id\") REFERENCES \"public\".\"usuarios\"(\"id\") ON DELETE cascade ON UPDATE no action;",
      "ALTER TABLE \"topes\" ADD CONSTRAINT \"topes_usuario_id_usuarios_id_fk\" FOREIGN KEY (\"usuario_id\") REFERENCES \"public\".\"usuarios\"(\"id\") ON DELETE cascade ON UPDATE no action;",
      "CREATE INDEX \"gastos_fecha_idx\" ON \"gastos\" USING btree (\"usuario_id\",\"ocurrio_en\");",
      "CREATE INDEX \"instancias_mes_idx\" ON \"instancias\" USING btree (\"usuario_id\",\"mes\");",
      "CREATE INDEX \"repartos_gasto_idx\" ON \"repartos\" USING btree (\"usuario_id\",\"gasto_id\");",
      "CREATE INDEX \"sesiones_usuario_idx\" ON \"sesiones\" USING btree (\"usuario_id\");",
      "CREATE UNIQUE INDEX \"usuarios_correo_idx\" ON \"usuarios\" USING btree (\"correo\");",
    ],
  },
];
