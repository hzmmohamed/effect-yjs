{
  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs?rev=e576e3c9cf9bad747afcddd9e34f51d18c855b4e";
  };
  outputs = {nixpkgs, ...}: let
    forAllSystems = function:
      nixpkgs.lib.genAttrs nixpkgs.lib.systems.flakeExposed
      (system: function nixpkgs.legacyPackages.${system});
  in {
    formatter = forAllSystems (pkgs: pkgs.alejandra);
    devShells = forAllSystems (pkgs: {
      default = pkgs.mkShell {
        packages = with pkgs; [
          corepack
          nodejs_24
          bun
          # For systems that do not ship with Python by default (required by `node-gyp`)
          python3
        ];
      };
    });
  };
}
