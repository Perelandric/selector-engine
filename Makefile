SHELL := /bin/bash


# Variables expanded in place
# ===========================

# source files
utilities_js	:= src/utilities.js
wrapper_js 		:= src/wrapper.js
exported_js 	:= src/exported.js
lexer_js 			:= src/lexer.js
parser_js 		:= src/parser.js
engine_js 		:= src/engine.js

# test files
test_js			:= test/test.js

# target files
base						:= lib/selector-engine
full						:= $(base).js
compiled				:= $(base).min.js
compiled_legacy	:= $(base)-legacy.min.js
gzipped					:= $(compiled).gz
gzipped_legacy	:= $(compiled_legacy).gz

# compiler settings
debug_mode	:= DEBUG_MODE=false
legacy_mode	:= LEGACY=false
out_wrap_license := "/* selector-engine | (c) 2016 Perelandric | MIT License */"
out_wrap_open := ";(function(global) {"
out_wrap_middle := "%output%"
out_wrap_close := "})(this);"
full_wrapper := $(out_wrap_license)$(out_wrap_open)$(out_wrap_middle)$(out_wrap_close)

all_files := $(exported_js) $(lexer_js) $(parser_js) $(engine_js) $(utilities_js)


# Variables expanded at point of use
# ==================================

# closure compiler
closure_params = @java -jar '$(CLOSURE)' \
  --js $(all_files) \
  --output_wrapper $(full_wrapper) \
	--js_output_file $@ \
	--compilation_level ADVANCED \
	--assume_function_wrapper \
	--define $(debug_mode) \
	--define $(legacy_mode) \
  --language_in ECMASCRIPT6 \
  --language_out ECMASCRIPT3; \
	echo done;


# Rules

.PHONY: all force test clean


all: $(compiled) $(compiled_legacy) sizes test


# Force a full make to take place by first removing generated files
force: clean all


#debug: set_debug build
#set_debug:
#	$(eval debug_mode := DEBUG_MODE=true)


$(full): $(all_files)
	@mkdir -p $(dir $@)
	@echo -n Creating $@...
	@echo $(out_wrap_license) > $@
	@echo $(out_wrap_open) >> $@
	@cat $(all_files) >> $@
	@echo -n $(out_wrap_close) >> $@
	@echo done


$(compiled_legacy): $(full)
	$(eval legacy_mode := LEGACY=true)
	@echo -n Compiling $@...
	$(closure_params)


$(compiled): $(full)
	@echo -n Compiling $@...
	$(closure_params)


# This is just to get the size of the gzipped file, which is removed
sizes:
	@gzip --keep $(compiled) $(compiled_legacy);
	@stat --printf="%-40n: %5s\n" $(full) $(compiled_legacy) $(compiled) $(gzipped_legacy) $(gzipped)
	@rm $(gzipped) $(gzipped_legacy);


test:
	@node $(test_js)


#lint:
#	touch $(full)
#	eslint --quiet --fix $(full)

clean:
	@rm -f $(base)*
