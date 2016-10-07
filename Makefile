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
comp_level	:= WHITESPACE_ONLY
formatting	:= --formatting PRETTY_PRINT


# WOULD NEED A SECTION TO DEFINE DEPENDENCIES.


# Variables expanded at point of use
# ==================================

# closure compiler
closure_params = @java -jar '$(CLOSURE)' \
  --js $(exported_js) $(lexer_js) $(parser_js) $(engine_js) $(utilities_js) \
  --output_wrapper_file $(wrapper_js) \
	--js_output_file $@ \
	--compilation_level $(comp_level) \
	--assume_function_wrapper \
	--define $(debug_mode) \
	--define $(legacy_mode) \
  --language_in ECMASCRIPT6 \
  --language_out ECMASCRIPT3 \
	$(formatting); \
	echo done;


# Rules

.PHONY: all test clean


all: $(compiled) $(compiled_legacy) sizes


debug: set_debug build


set_debug:
	$(eval debug_mode := DEBUG_MODE=true)


set_advanced:
	$(eval comp_level := ADVANCED)
	$(eval formatting := )


set_legacy:
	$(eval legacy_mode := LEGACY=true)


$(full):
	@mkdir -p $(dir $@)
	@echo -n Creating $@...
	$(closure_params)


$(compiled_legacy): $(full) set_legacy
	@echo -n Compiling $@...
	$(closure_params)


$(compiled): $(full) set_advanced
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
