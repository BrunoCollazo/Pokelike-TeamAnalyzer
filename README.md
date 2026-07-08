# Pokelike Team Analyzer

Userscript (Tampermonkey) para [Pokelike](https://pokelike.xyz). 
Agrega un panel flotante que analiza tu equipo en tiempo real: cobertura ofensiva, debilidades, preview de jefes y ayuda para decidir en las pantallas de captura y de equipo lleno.

## Que hace

- **Equipo** - cada Pokemon con su tipo y su ataque. Pasa el mouse por encima para ver debilidades, resistencias e inmunidades.
- **Debilidad comun** - solo los tipos que le pegan x2 a *todo* el equipo.
- **Cobertura SE** - agrupada por ataque: que tipos cubres super efectivo y con cual.
- **Jefes** - el jefe actual sus pokemons y con que le haces SE; toggle para poder ver los jefes de siguientes mapas.
- **Pantalla de captura** - por cada candidato: cobertura nueva que aporta, si tapa un hueco de debilidad del equipo y que resiste.
- **Equipo lleno (swap)** - por cada miembro, que gana o pierde el equipo si lo cambias por el que entra.

## Notas de mecanica

- Usa la tabla de tipos **en vivo del juego** (Gen 5 + Fairy). El tipo Fairy funciona en el daño (verificado en batalla).
- Un ataque x0 o x1/% (doble resistencia) hace **Struggle (50 pot)**, no cero daño - el panel lo refleja.

## Instalacion

1. Instala [Tampermonkey](https://www.tampermonkey.net/).
2. Crea un script nuevo y pega el contenido de [`pokelike_team_analyzer.js`](pokelike_team_analyzer.js).
3. Entra a pokelike.xyz - el panel aparece arriba a la derecha (se puede arrastrar y colapsar).

Funciona bien junto a los otros userscripts de Pokelike (Weakness Panel, Fairy Fix, Evolution Level, Move Tier Hover).

## Creditos

Creado por Bruno Collaz. Inspirado en el ecosistema de userscripts de Pokelike de VasariRulez.

## Licencia

MIT
