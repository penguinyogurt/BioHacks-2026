# Each accepted modality has a distinct meaning; do not pool arbitrary gene/disease edges.
TREATS=("DRUGBANK::treats::Compound:Disease","GNBR::T::Compound:Disease","Hetionet::CtD::Compound:Disease")
TARGET=("DRUGBANK::target::Compound:Gene","Hetionet::CbG::Compound:Gene")
ASSOCIATION="Hetionet::DaG::Disease:Gene"
PARTICIPATES="Hetionet::GpBP::Gene:Biological Process"
