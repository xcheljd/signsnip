#!/usr/bin/env bash
# CLI / engine edge cases. Each line: what, exit code, first line of output.
cd ~/Labs/sign-o-matic
export SIGNO_DATA=$(mktemp -d)
S=bin/signo.mjs; O=$SIGNO_DATA
t() { local name="$1"; shift; out=$("$@" 2>&1); code=$?; printf '%-46s exit=%s  %s\n' "$name" "$code" "$(echo "$out" | head -1 | cut -c1-150)"; }
$S brands >/dev/null
# --- adding signs
t "percent 0"                 $S add --brand northwind --percent 0
t "percent 100"               $S add --brand northwind --percent 100
t "percent 12.5"              $S add --brand northwind --percent 12.5
t "percent abc"               $S add --brand northwind --percent abc
t "no percent, no price"      $S add --brand northwind --collection X
t "price 0"                   $S add --brand northwind --price 0
t "price -5"                  $S add --brand northwind --price -5
t "price \$1,295.50"          $S add --brand northwind --price '$1,295.50'
t "price 9999999"             $S add --brand northwind --price 9999999
t "was < price"               $S add --brand northwind --price 300 --was 200
t "copies 0"                  $S add --brand northwind --percent 50 --copies 0
t "copies 500"                $S add --brand northwind --percent 50 --copies 500
t "empty collection"          $S add --brand northwind --percent 50 --collection ""
t "empty prefix+coll+footer"  $S add --brand northwind --percent 50 --collection "" --prefix "" --footer ""
t "61-char collection"        $S add --brand northwind --percent 50 --collection "$(printf 'A%.0s' {1..61})"
t "unicode/emoji collection"  $S add --brand northwind --percent 50 --collection "Café Ñandú ✨"
t "regex chars collection"    $S add --brand northwind --percent 50 --collection "Dive (300m) [Pro]+"
t "single 60-char word"       $S add --brand northwind --percent 50 --collection "$(printf 'W%.0s' {1..60})"
t "brand ambiguous 'a'"       $S add --brand a --percent 50
t "brand empty"               $S add --brand "" --percent 50
t "template missing"          $S add --brand northwind --template nope --percent 50
t "preset missing"            $S add --preset nope
t "export"                    $S export -o $O/a.pdf
t "check"                     $S check
# --- bulk / rm
t "bulk rows 0"               $S bulk --rows 0 --percent 10
t "bulk rows 3-1"             $S bulk --rows 3-1 --percent 10
t "bulk rows abc"             $S bulk --rows abc --percent 10
t "bulk nothing"              $S bulk --rows 1
t "bulk price tpl no price"   $S bulk --rows 1 --template price
t "rm 999"                    $S rm 999
# --- CSV
printf 'brand,collection,percent\nnorthwind,"Unclosed quote,50\n' > $O/bad1.csv;   t "csv unclosed quote" $S import $O/bad1.csv
printf 'collection,percent\nX,50\n' > $O/bad2.csv;                               t "csv no brand column" $S import $O/bad2.csv
printf '\xef\xbb\xbfbrand,collection,percent\r\nnorthwind,BOM Line,40\r\n' > $O/bom.csv; t "csv BOM + CRLF" $S import $O/bom.csv
printf 'Brand,Collection,Percent,Copies\nnorthwind,Caps,30,2\n' > $O/caps.csv;      t "csv capitalised headers" $S import $O/caps.csv
printf 'brand,collection,price,was\nkestrel,P,"$1,295","$1,595"\n' > $O/p.csv;   t "csv quoted money" $S import $O/p.csv
printf '' > $O/empty.csv;                                                        t "csv empty file" $S import $O/empty.csv
t "csv missing file"          $S import $O/nope.csv
# --- rules
t "rules min 3"               $S rules min 3
t "rules min abc"             $S rules min abc
t "abbr empty word"           $S rules abbr "" "x"
t "abbr regex word"           $S rules abbr "(300m)" "300"
t "abbr duplicate (case)"     $S rules abbr "chronograph" "Chr"
t "rules list"                bash -c "$S rules | grep -ic chrono"
t "abbr-rm missing"           $S rules abbr-rm nope
# --- templates
t "set unknown prop"          $S templates set percent offer.bogus=1
t "set size 200"              $S templates set percent offer.size=200
t "set size -1"               $S templates set percent offer.size=-1
t "set bad colour"            $S templates set percent offer.color=red
t "set no '='"                $S templates set percent offer.size
t "fallback self"             $S templates fallback percent percent
t "fallback chain loop"       bash -c "$S templates fallback percent percent-long && $S templates fallback percent-long percent"
t "export with loop ok"       $S export -o $O/loop.pdf
t "duplicate twice"           bash -c "$S templates duplicate bogo X && $S templates duplicate bogo X"
t "rename to empty"           $S templates rename x ""
t "rm template used in batch" bash -c "$S add --template x --brand orbital --percent 20 >/dev/null && $S templates rm x && $S batch | tail -2 | head -1"
t "export after rm (fallback)" $S export -o $O/rm.pdf
t "rm fallback target"        bash -c "$S templates rm percent-long && $S templates show percent | sed -n 2p"
t "export w/ dangling fallback" $S export -o $O/dang.pdf
echo '{"format":"sign-o-matic/template-set","version":1,"exportedAt":"x","templates":[]}' > $O/e.json; t "import empty set" $S templates import $O/e.json
echo 'not json' > $O/n.json;  t "import not json" $S templates import $O/n.json
python3 -c "import json;d=json.load(open('$O/../$(basename $O)/templates.json')) if False else None" 2>/dev/null
$S templates export bogo -o $O/b.json >/dev/null
python3 - "$O/b.json" <<'P'
import json,sys; p=sys.argv[1]; d=json.load(open(p)); d['templates'][0]['objects'][0]['x']=999; json.dump(d,open(p,'w'))
P
t "import out-of-range object" $S templates import $O/b.json
# --- brands & logos
t "brand add empty name"      $S brands add ""
t "brand add emoji name"      $S brands add "🦊 Fox"
printf 'not an image' > $O/x.png; t "logo junk file" $S brands logo northwind $O/x.png
python3 -c "
from PIL import Image; Image.new('RGBA',(4000,40),(0,0,0,255)).save('$O/wide.png'); Image.new('RGBA',(40,4000),(0,0,0,255)).save('$O/tall.png'); Image.new('RGBA',(300,300),(0,0,0,0)).save('$O/blank.png'); Image.new('RGB',(12,8),(20,20,20)).save('$O/tiny.png')"
t "logo very wide"            $S brands logo northwind $O/wide.png
t "logo very tall"            $S brands logo kestrel $O/tall.png
t "logo fully transparent"    $S brands logo tidemark $O/blank.png
t "logo tiny 12x8"            $S brands logo orbital $O/tiny.png
t "fix-bg already transparent" $S brands fix-bg kestrel
t "restore without original"  $S brands restore lumen
t "brands scale 9"            $S brands scale lumen 9
t "rm brand used in batch"    bash -c "$S brands rm northwind && $S batch | head -2"
t "export after brand rm"     $S export -o $O/br.pdf
t "check after brand rm"      bash -c "$S check | head -3 | tr '\n' ' '"
# --- saved batches
t "save empty batch"          bash -c "$S clear >/dev/null && $S save Empty"
t "load missing"              $S load nope
t "save name with slash"      bash -c "$S add --brand orbital --percent 50 >/dev/null && $S save 'Sale 11/28' && $S batches | head -1"
t "save same name twice"      bash -c "$S save 'Sale 11/28' && $S batches | wc -l"
# --- big batch
t "500 rows import"           bash -c "python3 -c \"print('brand,collection,percent'); [print(f'orbital,Line {i},{10+i%80}') for i in range(499)]\" > $O/big.csv && $S clear >/dev/null && $S import $O/big.csv"
t "501st row"                 $S add --brand orbital --percent 5
t "export 500 rows timing"    bash -c "s=\$(date +%s%N); $S export -o $O/big.pdf >/dev/null; echo \$(( (\$(date +%s%N)-s)/1000000 ))ms \$(pdfinfo $O/big.pdf | grep Pages)"
t "calibrate a4"              $S calibrate --paper a4 -o $O/c.pdf
t "export bad grid"           $S export --grid 3x3 -o $O/g.pdf
